import { createHash, randomUUID } from 'node:crypto'
import { locationRefKey, type LocationRef } from '../../aviation/types.js'
import { researchArtifactSchema, researchBriefSchema, type ResearchArtifact, type ResearchBrief } from '../../research-agent/types.js'
import { classifyResearchSourceAuthority } from '../../research-agent/verification.js'

export interface DshEvidenceScope {
  ownerId: string
  tripId: string
  conversationId: string
  generationId: string
  tripContextVersion: number
}

export type DshEvidenceDepth = 'search_snippet' | 'fetched_body' | 'none'
export type DshEvidenceStatus = 'available' | 'http_error' | 'no_body' | 'tool_error' | 'invalid_url'

export interface DshEvidenceRecord extends DshEvidenceScope {
  evidenceRef: string
  provider: string
  toolCallId: string
  retrievedAt: string
  url: string
  finalUrl?: string
  title?: string
  snippet?: string
  body?: string
  contentHash?: string
  depth: DshEvidenceDepth
  status: DshEvidenceStatus
  statusCode?: number
  truncated: boolean
  untrusted: true
}

export interface DshEvidenceRepository {
  put(record: DshEvidenceRecord): Promise<void>
  get(evidenceRef: string): Promise<DshEvidenceRecord | null>
}

export class InMemoryDshEvidenceRepository implements DshEvidenceRepository {
  private readonly records = new Map<string, DshEvidenceRecord>()

  async put(record: DshEvidenceRecord): Promise<void> {
    this.records.set(record.evidenceRef, structuredClone(record))
  }

  async get(evidenceRef: string): Promise<DshEvidenceRecord | null> {
    const record = this.records.get(evidenceRef)
    return record ? structuredClone(record) : null
  }
}

export interface DshSearchResult {
  status?: string
  sources?: Array<{ url?: string; title?: string; snippet?: string; publishedAt?: string }>
  error?: unknown
  truncated?: boolean
}

export interface DshFetchResult {
  status?: string
  statusCode?: number
  url?: string
  title?: string
  snippet?: string
  body?: { kind: 'text' | 'html'; content: string }
  error?: unknown
  truncated?: boolean
}

export interface DshEvidenceReferenceList {
  evidenceRefs: string[]
  urls: string[]
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return
    url.hash = ''
    return url.toString()
  } catch { return }
}

function scopeMatches(record: DshEvidenceRecord, scope: DshEvidenceScope): boolean {
  return record.ownerId === scope.ownerId && record.tripId === scope.tripId
    && record.conversationId === scope.conversationId && record.generationId === scope.generationId
    && record.tripContextVersion === scope.tripContextVersion
}

function sameLocation(left: LocationRef, right: LocationRef): boolean {
  return locationRefKey(left) === locationRefKey(right)
}

export class DshEvidenceStore {
  private readonly repository: DshEvidenceRepository
  private readonly now: () => Date

  constructor(private readonly scope: DshEvidenceScope, options: { repository?: DshEvidenceRepository; now?: () => Date } = {}) {
    this.repository = options.repository ?? new InMemoryDshEvidenceRepository()
    this.now = options.now ?? (() => new Date())
  }

  async recordSearch(result: DshSearchResult, provider: string, toolCallId: string): Promise<DshEvidenceReferenceList> {
    const items = Array.isArray(result?.sources) ? result.sources : []
    const records = await Promise.all(items.map(item => {
      const url = safeHttpUrl(item?.url)
      const snippet = typeof item?.snippet === 'string' ? item.snippet.trim().slice(0, 800) : ''
      const failed = result.error !== undefined || result.status === 'error' || result.status === 'failed'
      const truncated = result.truncated === true
      const status: DshEvidenceStatus = !url ? 'invalid_url' : failed ? 'tool_error' : !snippet ? 'no_body' : 'available'
      return this.save({
        url: url ?? (typeof item?.url === 'string' ? item.url.slice(0, 500) : ''),
        ...(typeof item?.title === 'string' ? { title: item.title.trim().slice(0, 240) } : {}),
        ...(snippet ? { snippet } : {}),
        depth: status === 'available' ? 'search_snippet' : 'none', status, truncated
      }, provider, toolCallId)
    }))
    return this.references(records)
  }

  async recordFetch(requestUrl: string, result: DshFetchResult, provider: string, toolCallId: string): Promise<DshEvidenceReferenceList> {
    const requested = safeHttpUrl(requestUrl)
    const url = requested ?? requestUrl.slice(0, 500)
    const finalUrl = safeHttpUrl(result?.url)
    const statusCode = result?.statusCode
    const bodyValue = result?.body && ['text', 'html'].includes(result.body.kind) ? result.body.content : undefined
    const body = typeof bodyValue === 'string' ? bodyValue.trim().slice(0, 12_000) : ''
    const snippetValue = typeof result?.snippet === 'string' ? result.snippet : body
    const snippet = snippetValue.trim().slice(0, 800)
    const truncated = result?.truncated === true || (typeof bodyValue === 'string' && bodyValue.length > 12_000)
    const failed = !requested || result?.error !== undefined || statusCode === undefined || statusCode < 200 || statusCode >= 300
    const status: DshEvidenceStatus = !requested ? 'invalid_url' : failed ? (statusCode !== undefined && (statusCode < 200 || statusCode >= 300) ? 'http_error' : 'tool_error') : !body ? 'no_body' : 'available'
    const record = await this.save({ url, ...(finalUrl && finalUrl !== url ? { finalUrl } : {}), ...(typeof result?.title === 'string' ? { title: result.title.trim().slice(0, 240) } : {}),
      ...(snippet ? { snippet } : {}), ...(body ? { body } : {}), depth: status === 'available' ? 'fetched_body' : 'none', status, truncated,
      ...(statusCode === undefined ? {} : { statusCode }) }, provider, toolCallId)
    return this.references([record])
  }

  async get(evidenceRef: string): Promise<DshEvidenceRecord | null> {
    const record = await this.repository.get(evidenceRef)
    return record && scopeMatches(record, this.scope) ? record : null
  }

  timestamp(): string {
    const date = this.now()
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
  }

  private async save(record: Omit<DshEvidenceRecord, keyof DshEvidenceScope | 'evidenceRef' | 'provider' | 'toolCallId' | 'retrievedAt' | 'contentHash' | 'untrusted'>,
    provider: string, toolCallId: string): Promise<DshEvidenceRecord> {
    const retrievedAt = this.timestamp()
    const digestInput = record.body ?? record.snippet ?? ''
    const saved: DshEvidenceRecord = { ...this.scope, ...record, evidenceRef: randomUUID(), provider: provider.slice(0, 64),
      toolCallId: toolCallId.slice(0, 160), retrievedAt,
      ...(digestInput ? { contentHash: createHash('sha256').update(digestInput).digest('hex') } : {}), untrusted: true }
    await this.repository.put(saved)
    return saved
  }

  private references(records: readonly DshEvidenceRecord[]): DshEvidenceReferenceList {
    const usable = records.filter(record => record.status === 'available')
    return { evidenceRefs: usable.map(record => record.evidenceRef), urls: usable.map(record => record.finalUrl ?? record.url) }
  }
}

export interface DshResearchCandidate {
  key: string
  evidenceRefs: string[]
  title: string
  summary: string
  category: ResearchBrief['researchTypes'][number]
  /** Supplied by the trusted caller after resolving against the current Trip. */
  location: LocationRef
}

export interface DshResearchConversionInput {
  candidates: DshResearchCandidate[]
  brief: ResearchBrief
  artifactId: string
}

export async function convertCandidatesToResearch(input: DshResearchConversionInput, store: DshEvidenceStore): Promise<ResearchArtifact> {
  const brief = researchBriefSchema.parse(input.brief)
  const findings = await Promise.all(input.candidates.map(async candidate => {
    if (!brief.researchTypes.includes(candidate.category)) throw new Error(`Candidate category is outside brief: ${candidate.key}`)
    const location = candidate.location
    if (!brief.destinations.some(destination => sameLocation(destination, location))) throw new Error(`Candidate location is outside brief: ${candidate.key}`)
    if (!Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length === 0) throw new Error(`Candidate has no evidence: ${candidate.key}`)
    const records = await Promise.all(candidate.evidenceRefs.map(ref => store.get(ref)))
    if (records.some(record => !record || record.status !== 'available')) throw new Error(`Candidate evidence is unavailable: ${candidate.key}`)
    const sources = records.map(record => {
      const evidence = record!
      const url = evidence.finalUrl ?? evidence.url
      const parsed = new URL(url)
      const snippet = evidence.snippet ?? evidence.body?.slice(0, 800)
      if (!snippet) throw new Error(`Candidate source has no snippet: ${candidate.key}`)
      const text = evidence.body
      return {
        title: evidence.title || parsed.hostname,
        url,
        domain: parsed.hostname,
        snippet,
        authority: classifyResearchSourceAuthority(url),
        ...(text && evidence.contentHash ? { page: { text, retrievedAt: evidence.retrievedAt, contentHash: evidence.contentHash } } : {})
      }
    })
    return {
      id: candidate.key,
      category: candidate.category,
      destinations: [location],
      title: candidate.title.trim().slice(0, 240),
      summary: candidate.summary.trim().slice(0, 1_500),
      sources,
      verification: { status: 'partially_verified' as const, checkedAt: store.timestamp(), confidence: 0.35,
        sources: records.map(record => ({ provider: record!.provider, reference: record!.finalUrl ?? record!.url })) },
      warnings: ['dsh_source_not_independently_verified', 'web_content_untrusted',
        ...(records.some(record => record!.truncated) ? ['source_content_truncated'] : [])]
    }
  }))
  return researchArtifactSchema.parse({ id: input.artifactId, type: 'research', schemaVersion: 2, brief, findings,
    queryCount: 0, warnings: ['dsh_evidence_only', 'content_requires_domain_validation'], createdAt: store.timestamp() })
}
