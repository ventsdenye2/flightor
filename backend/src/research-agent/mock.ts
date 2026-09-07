import { createHash } from 'node:crypto'
import { researchArtifactSchema, researchBriefSchema, type LegacyResearchArtifact, type ResearchAgent, type ResearchArtifact, type ResearchBrief, type ResearchExecutionContext } from './types.js'
import type { ResearchSourceCandidate } from './search-provider.js'

type LegacyFindingInput = LegacyResearchArtifact['findings'][number]
type MockFindingInput = ResearchArtifact['findings'][number] | LegacyFindingInput

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return 'example.invalid'
  }
}

function isV2Finding(value: MockFindingInput): value is ResearchArtifact['findings'][number] {
  return 'category' in value && 'destinations' in value && 'sources' in value && 'verification' in value
}

function legacyVerification(value: LegacyFindingInput): ResearchArtifact['findings'][number]['verification'] {
  const status = value.confidence === 'confirmed' ? 'verified' : value.confidence === 'partial' ? 'partially_verified' : 'unverified'
  return {
    status,
    checkedAt: value.verifiedAt,
    expiresAt: value.verifiedAt,
    confidence: status === 'verified' ? 0.9 : status === 'partially_verified' ? 0.5 : 0.2,
    sources: value.sourceUrls.slice(0, 20).map(url => ({ provider: 'mock-research', reference: url }))
  }
}

function legacySource(value: LegacyFindingInput): ResearchSourceCandidate[] {
  return value.sourceUrls.slice(0, 20).map(url => ({
    title: value.title,
    snippet: value.summary,
    url,
    domain: domainOf(url),
    authority: 'unknown' as const
  }))
}

function normalizeFinding(value: MockFindingInput, brief: ResearchBrief, index: number): ResearchArtifact['findings'][number] {
  if (isV2Finding(value)) return structuredClone(value)
  const destination = brief.destinations[0]
  if (!destination) throw new Error('Mock research requires a destination')
  const sources = legacySource(value)
  const verification = legacyVerification(value)
  const category = brief.researchTypes[0] ?? 'activity'
  const id = `finding_${createHash('sha256').update(JSON.stringify({ index, title: value.title, sources })).digest('hex').slice(0, 24)}`
  return {
    id,
    category,
    destinations: [destination],
    title: value.title,
    summary: value.summary,
    sources,
    verification,
    warnings: verification.status === 'verified' ? [] : ['mock_evidence_is_partial']
  }
}

/** In-memory v2 implementation used by domain and contract tests. */
export class MockResearchAgent implements ResearchAgent {
  constructor(private readonly findings: readonly MockFindingInput[] = []) {}

  async research(brief: ResearchBrief, context: ResearchExecutionContext): Promise<ResearchArtifact> {
    if (context.signal?.aborted) throw context.signal.reason ?? new Error('Research cancelled')
    const validBrief = researchBriefSchema.parse(brief)
    const normalizedFindings = this.findings
      .map((finding, index) => normalizeFinding(finding, validBrief, index))
      .slice(0, validBrief.maxResults ?? 10)
    const digest = createHash('sha256').update(JSON.stringify({ brief: validBrief, findings: normalizedFindings })).digest('hex').slice(0, 24)
    return researchArtifactSchema.parse({
      id: `research_${digest}`,
      type: 'research',
      schemaVersion: 2,
      brief: validBrief,
      findings: normalizedFindings,
      queryCount: 0,
      warnings: [],
      createdAt: new Date().toISOString()
    })
  }
}
