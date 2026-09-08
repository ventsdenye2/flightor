import { v7 as uuidv7 } from 'uuid'
import { checkpoint, saveWorkspaceArtifact, type ArtifactWorkspace } from '../artifacts/workspace.js'
import type { VerificationRecord } from '../aviation/types.js'
import { researchArtifactSchema, researchBriefSchema, type ResearchAgent, type ResearchArtifact, type ResearchBrief } from './types.js'
import type { TripContext } from '../trips/types.js'

export function researchTravelWindow(trip: TripContext): ResearchBrief['travelWindow'] {
  const from = trip.departureWindow?.from
  const lastDeparture = trip.departureWindow?.to ?? from
  const inferredEnd = lastDeparture && trip.travelDays ? new Date(Date.parse(`${lastDeparture}T00:00:00Z`) + (trip.travelDays - 1) * 86_400_000).toISOString().slice(0, 10) : lastDeparture
  const to = trip.returnWindow?.to ?? inferredEnd
  return from || to ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : undefined
}

export function researchStatusCounts(artifact: ResearchArtifact) {
  return artifact.findings.reduce((counts, finding) => { counts[finding.verification.status] += 1; return counts }, { verified: 0, partially_verified: 0, stale: 0, unverified: 0 })
}

function verification(artifact: ResearchArtifact): VerificationRecord {
  const counts = researchStatusCounts(artifact)
  const status = artifact.findings.length === 0 || counts.unverified === artifact.findings.length ? 'unverified'
    : counts.unverified > 0 || counts.stale > 0 || counts.partially_verified > 0 ? 'partially_verified' : 'verified'
  const sources = new Map<string, VerificationRecord['sources'][number]>()
  for (const finding of artifact.findings) for (const source of finding.verification.sources) sources.set(`${source.provider}:${source.reference ?? ''}`, source)
  return { status, checkedAt: artifact.createdAt, confidence: artifact.findings.length ? Math.min(...artifact.findings.map(f => f.verification.confidence)) : 0, sources: [...sources.values()].slice(0, 20) }
}

export async function researchTripDestinations(input: ResearchBrief, research: ResearchAgent, scope: ArtifactWorkspace & { requestId: string }) {
  const brief = researchBriefSchema.parse(input)
  await checkpoint(scope)
  const result = researchArtifactSchema.parse(await research.research(brief, { requestId: scope.requestId, ...(scope.signal ? { signal: scope.signal } : {}) }))
  if (JSON.stringify(result.brief) !== JSON.stringify(brief)) throw new Error('Research agent returned a mismatched brief')
  if (result.findings.length > (brief.maxResults ?? 10)) throw new Error('Research agent returned too many findings')
  const payload = researchArtifactSchema.parse({ ...result, id: uuidv7() })
  const record = await saveWorkspaceArtifact(scope, { id: payload.id, type: 'research', schemaVersion: 2, payload, verification: verification(payload) })
  return { record, payload }
}
