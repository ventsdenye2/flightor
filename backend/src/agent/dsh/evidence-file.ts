import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import type { DshEvidenceRecord, DshEvidenceRepository } from './evidence.js'

const MAX_RECORD_BYTES = 1024 * 1024
const UUID_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256_REF = /^[a-f0-9]{64}$/
const recordSchema = z.object({
  ownerId: z.string().min(1), tripId: z.string().min(1), conversationId: z.string().min(1), generationId: z.string().min(1),
  tripContextVersion: z.number().int().nonnegative(), evidenceRef: z.string(), provider: z.string().min(1).max(64),
  toolCallId: z.string().min(1).max(160), retrievedAt: z.iso.datetime(), url: z.string().max(500), finalUrl: z.string().max(500).optional(),
  title: z.string().max(240).optional(), snippet: z.string().max(800).optional(), body: z.string().max(12_000).optional(),
  contentHash: z.string().regex(SHA256_REF).optional(), depth: z.enum(['search_snippet', 'fetched_body', 'none']),
  status: z.enum(['available', 'http_error', 'no_body', 'tool_error', 'invalid_url']), statusCode: z.number().int().min(0).max(999).optional(),
  truncated: z.boolean(), untrusted: z.literal(true)
}).strict().refine(record => !record.contentHash || record.contentHash === createHash('sha256').update(record.body ?? record.snippet ?? '').digest('hex'))

interface EvidenceEnvelope {
  schemaVersion: 1
  record: DshEvidenceRecord
  digest: string
}

function assertEvidenceRef(value: string): void {
  if (!UUID_REF.test(value) && !SHA256_REF.test(value)) throw new TypeError('Evidence reference must be a canonical UUID or lowercase SHA-256')
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function recordDigest(record: DshEvidenceRecord): string {
  return createHash('sha256').update(canonicalJson(record)).digest('hex')
}

function identityDigest(record: DshEvidenceRecord): string {
  const { evidenceRef: _evidenceRef, ...identity } = record
  return createHash('sha256').update(canonicalJson(identity)).digest('hex')
}

function isRecord(value: unknown): value is DshEvidenceRecord {
  return recordSchema.safeParse(value).success
}

function envelopeFor(record: DshEvidenceRecord): EvidenceEnvelope {
  return { schemaVersion: 1, record, digest: recordDigest(record) }
}

function parseEnvelope(input: Buffer, evidenceRef: string): EvidenceEnvelope {
  if (input.byteLength > MAX_RECORD_BYTES) throw new Error('Evidence record exceeds 1 MiB')
  let value: unknown
  try { value = JSON.parse(input.toString('utf8')) } catch { throw new Error('Evidence record is corrupt JSON') }
  if (!value || typeof value !== 'object') throw new Error('Evidence record envelope is invalid')
  const envelope = value as Partial<EvidenceEnvelope>
  if (envelope.schemaVersion !== 1 || !isRecord(envelope.record) || envelope.record.evidenceRef !== evidenceRef
    || typeof envelope.digest !== 'string' || !SHA256_REF.test(envelope.digest)) throw new Error('Evidence record envelope is invalid')
  if (recordDigest(envelope.record) !== envelope.digest) throw new Error('Evidence record digest mismatch')
  return envelope as EvidenceEnvelope
}

/** A private local repository. The root must come from trusted server configuration. */
export class FileDshEvidenceRepository implements DshEvidenceRepository {
  private readonly rootDirectory: string

  constructor(rootDirectory: string) {
    if (!isAbsolute(rootDirectory)) throw new TypeError('Evidence repository root must be an absolute path')
    this.rootDirectory = resolve(rootDirectory)
  }

  async put(record: DshEvidenceRecord): Promise<void> {
    assertEvidenceRef(record.evidenceRef)
    if (!isRecord(record)) throw new TypeError('Evidence record is invalid')
    if (SHA256_REF.test(record.evidenceRef) && record.evidenceRef !== identityDigest(record)) {
      throw new Error('SHA-256 evidence reference does not match record content')
    }
    const envelope = envelopeFor(record)
    const contents = Buffer.from(JSON.stringify(envelope), 'utf8')
    if (contents.byteLength > MAX_RECORD_BYTES) throw new Error('Evidence record exceeds 1 MiB')

    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 })
    const target = join(this.rootDirectory, `${record.evidenceRef}.json`)
    const lockPath = join(this.rootDirectory, `${record.evidenceRef}.lock`)
    let lockHandle: FileHandle
    try {
      lockHandle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Evidence write is already in progress')
      throw error
    }

    const temporary = join(this.rootDirectory, `.${record.evidenceRef}.${randomUUID()}.tmp`)
    try {
      try {
        const existing = await this.readEnvelope(target, record.evidenceRef)
        if (existing) {
          if (existing.digest !== envelope.digest) throw new Error('Evidence reference already contains different content')
          return
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }

      const tempHandle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      try {
        await tempHandle.writeFile(contents)
        await tempHandle.sync()
      } finally {
        await tempHandle.close()
      }
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true })
      await lockHandle.close()
      await rm(lockPath, { force: true })
    }
  }

  async get(evidenceRef: string): Promise<DshEvidenceRecord | null> {
    assertEvidenceRef(evidenceRef)
    const target = join(this.rootDirectory, `${evidenceRef}.json`)
    const envelope = await this.readEnvelope(target, evidenceRef)
    return envelope?.record ?? null
  }

  private async readEnvelope(path: string, evidenceRef: string): Promise<EvidenceEnvelope | null> {
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isFile()) throw new Error('Evidence record is not a regular file')
      if (info.size > MAX_RECORD_BYTES) throw new Error('Evidence record exceeds 1 MiB')
      const contents = await readFile(path)
      return parseEnvelope(contents, evidenceRef)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
}
