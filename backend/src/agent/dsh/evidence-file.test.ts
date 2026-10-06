import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DshEvidenceStore, type DshEvidenceScope, type DshEvidenceRecord } from './evidence.js'
import { FileDshEvidenceRepository } from './evidence-file.js'

const scope: DshEvidenceScope = { ownerId: 'owner-1', tripId: 'trip-1', conversationId: 'conversation-1', generationId: 'generation-1', tripContextVersion: 3 }
const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'flightor-dsh-evidence-'))
  roots.push(value)
  return value
}

async function fixture(rootDirectory: string): Promise<DshEvidenceRecord> {
  const repository = new FileDshEvidenceRepository(rootDirectory)
  const store = new DshEvidenceStore(scope, { repository, now: () => new Date('2026-09-24T08:00:00.000Z') })
  const result = await store.recordSearch({ sources: [{ url: 'https://example.com/place', snippet: 'Original snippet.' }] }, 'web-search', 'tool-1')
  return (await repository.get(result.evidenceRefs[0]!))!
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('FileDshEvidenceRepository', () => {
  it('persists private records across repository instances and leaves scope checks to the Store', async () => {
    const directory = await root()
    const record = await fixture(directory)
    const reopened = new FileDshEvidenceRepository(directory)
    expect(await reopened.get(record.evidenceRef)).toEqual(record)
    if (process.platform !== 'win32') {
      expect((await stat(join(directory, `${record.evidenceRef}.json`))).mode & 0o777).toBe(0o600)
    }

    const foreignStore = new DshEvidenceStore({ ...scope, ownerId: 'other-owner' }, { repository: reopened })
    expect(await foreignStore.get(record.evidenceRef)).toBeNull()
  })

  it('accepts identical retries and rejects the same ref with changed payload', async () => {
    const directory = await root()
    const record = await fixture(directory)
    const repository = new FileDshEvidenceRepository(directory)
    await expect(repository.put(record)).resolves.toBeUndefined()
    await expect(repository.put({ ...record, provider: 'different-provider' })).rejects.toThrow(/different content/)
    expect(await repository.get(record.evidenceRef)).toEqual(record)
  })

  it('does not pass an alias from another version or generation to the file repository', async () => {
    const directory = await root()
    const repository = new FileDshEvidenceRepository(directory)
    const repositoryGet = vi.spyOn(repository, 'get')
    const current = new DshEvidenceStore(scope, { repository })
    const captured = await current.recordSearch({ sources: [{ url: 'https://example.com/place', snippet: 'Version three.' }] }, 'web-search', 'tool-version-3')
    const nextVersion = new DshEvidenceStore({ ...scope, tripContextVersion: scope.tripContextVersion + 1 }, { repository })
    const nextGeneration = new DshEvidenceStore({ ...scope, generationId: 'generation-2' }, { repository })

    await expect(nextVersion.get(captured.sourceRefs[0]!)).resolves.toBeNull()
    await expect(nextGeneration.get(captured.sourceRefs[0]!)).resolves.toBeNull()
    await expect(nextVersion.get('s1.malformed')).resolves.toBeNull()
    expect(repositoryGet).not.toHaveBeenCalled()
    await expect(nextVersion.get(captured.evidenceRefs[0]!)).resolves.toBeNull()
    expect(repositoryGet).toHaveBeenCalledWith(captured.evidenceRefs[0])
    await expect(current.get(captured.evidenceRefs[0]!)).resolves.toMatchObject({ snippet: 'Version three.' })
  })

  it('rejects path traversal and surfaces corrupt persisted records', async () => {
    const directory = await root()
    const repository = new FileDshEvidenceRepository(directory)
    await expect(repository.get('../outside')).rejects.toThrow(/canonical UUID or lowercase SHA-256/)

    const evidence = new DshEvidenceStore(scope, { repository })
    const captured = await evidence.recordSearch({ sources: [{ url: 'https://example.com/place', snippet: 'Corrupt me.' }] }, 'web-search', 'tool-corrupt')
    const evidenceRef = captured.evidenceRefs[0]!

    const file = join(directory, `${evidenceRef}.json`)
    await writeFile(file, '{broken', { mode: 0o600 })
    await expect(repository.get(evidenceRef)).rejects.toThrow(/corrupt JSON/)
    await expect(evidence.get(captured.sourceRefs[0]!)).rejects.toThrow(/corrupt JSON/)
    await expect(readFile(file, 'utf8')).resolves.toBe('{broken')
  })
})
