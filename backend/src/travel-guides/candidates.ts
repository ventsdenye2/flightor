import { z } from 'zod'
import { createHash } from 'node:crypto'
import { canonicalFingerprint } from '../agent/goals/repository.js'
import { loadWorkspaceArtifact, type ArtifactWorkspace } from '../artifacts/workspace.js'
import { researchArtifactSchema, type ResearchArtifact } from '../research-agent/types.js'

export const candidateRefSchema = z.string().min(1).max(160)
export const guideCandidateSchema = z.object({
  candidateRef: candidateRefSchema, researchArtifactId: z.string().uuid(), findingId: z.string().max(160),
  title: z.string().max(240), category: z.enum(['activity', 'practical', 'event', 'seasonal', 'stopover']),
  cityIds: z.array(z.string().max(160)).max(12),
  verificationStatus: z.enum(['verified', 'partially_verified', 'stale', 'unverified'])
}).strict()

type CandidateScope = Pick<ArtifactWorkspace, 'tripId' | 'tripContextVersion'> & { ownerId?: string | undefined }

/** A stable locator, not a capability. Every resolution repeats authenticated repository checks.
 * Canonical hashing survives JSONB key ordering and process restarts; facts come only from storage. */
export function guideCandidateRef(scope: CandidateScope, source: ResearchArtifact, findingId: string): string {
  return candidateLocator(source.id, candidateDigest(scope, source), findingId)
}

function candidateDigest(scope: CandidateScope, source: ResearchArtifact) {
  return canonicalFingerprint({ ownerId: scope.ownerId ?? '', tripId: scope.tripId, version: scope.tripContextVersion, source })
}
function candidateLocator(id: string, digest: string, findingId: string) {
  return `gc1.${id}.${createHash('sha256').update(`${digest}\0${findingId}`).digest('hex').slice(0, 32)}`
}

export function guideCandidates(scope: CandidateScope, source: ResearchArtifact, now = Date.now()) {
  const digest = candidateDigest(scope, source)
  return source.findings.map(finding => ({
    candidateRef: candidateLocator(source.id, digest, finding.id), researchArtifactId: source.id, findingId: finding.id,
    title: finding.title, category: finding.category, cityIds: finding.destinations.map(city => city.id),
    verificationStatus: finding.verification.expiresAt && Date.parse(finding.verification.expiresAt) <= now
      ? 'stale' as const : finding.verification.status
  }))
}

export function candidateArtifactId(ref: string): string | undefined {
  const parts = ref.split('.')
  return parts.length === 3 && parts[0] === 'gc1' && z.string().uuid().safeParse(parts[1]).success ? parts[1] : undefined
}

export async function resolveGuideCandidate(ref: string, scope: ArtifactWorkspace, cache: Map<string, ResearchArtifact>) {
  const id = candidateArtifactId(ref)
  if (!id) return undefined
  let source = cache.get(id)
  if (!source) {
    const record = await loadWorkspaceArtifact(scope, id, 'research', [2])
    const parsed = researchArtifactSchema.safeParse(record.payload)
    if (!parsed.success || parsed.data.id !== record.id) return undefined
    source = parsed.data
    cache.set(id, source)
  }
  const digest = candidateDigest(scope, source)
  const matches = source.findings.filter(value => candidateLocator(source!.id, digest, value.id) === ref)
  return matches.length === 1 ? { researchArtifactId: id, findingId: matches[0]!.id } : undefined
}
