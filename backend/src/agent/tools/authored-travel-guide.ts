import { z } from 'zod'
import { saveAuthoredTravelGuide } from '../../travel-guides/authored.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import type { TravelGuideConstraints } from '../../travel-guides/validation.js'
import { requiredGuideEvidenceTypes, travelGuideGoalParametersSchema } from '../goals/types.js'
import type { AgentTool } from '../runtime/registry.js'
import { workspaceScope } from './workspace-scope.js'
import { acceptGuideDraft, resolveGuideDraft, saveGuideInputSchema, type SaveGuideInput, type GuideRepairIssue } from './guide-draft.js'
import { guideCandidates, guideCandidateSchema, candidateArtifactId } from '../../travel-guides/candidates.js'
import { researchArtifactSchema } from '../../research-agent/types.js'
import { assertArtifactContextVersion } from '../../artifacts/repository.js'
import { tripDatesConsistent, tripTravelWindow } from '../../trips/dates.js'
import type { ArtifactWorkspace } from '../../artifacts/workspace.js'
import { isAppError } from '../../lib/errors.js'

const repairIssueSchema = z.object({ code: z.string().max(500), classification: z.enum(['draft_invalid', 'evidence_missing', 'context_conflict']),
  fieldPath: z.string().max(500).optional(), day: z.number().optional(), blockedChecks: z.array(z.string()).optional() }).strict()

const outputSchema = z.object({
  status: z.enum(['saved', 'needs_revision']),
  issues: z.array(z.string().max(500)).max(400),
  requirements: z.object({
    maxCities: travelGuideGoalParametersSchema.shape.maxCities,
    maxResults: travelGuideGoalParametersSchema.shape.maxResults,
    researchTypes: travelGuideGoalParametersSchema.shape.researchTypes,
    requiredEvidenceTypes: travelGuideGoalParametersSchema.shape.requiredEvidenceTypes,
    allowPartial: travelGuideGoalParametersSchema.shape.allowPartial,
    allowRestDays: travelGuideGoalParametersSchema.shape.allowRestDays
  }).strict().optional(),
  revisionGuidance: z.string().max(500).optional(),
  feedbackTruncated: z.boolean().optional(),
  details: z.array(z.object({ code: z.string().max(500), day: z.number().int().min(1).max(60).optional(), sourceFindingId: z.string().max(160).optional(),
    fieldPath: z.string().optional(), affectedDays: z.array(z.number()).optional(), category: z.string().optional(), location: z.string().optional(),
    date: z.string().optional(), blockedChecks: z.array(z.string()).optional() }).strict()).max(400).optional(),
  repair: z.object({ issues: z.array(repairIssueSchema).max(400), availableCandidates: z.array(guideCandidateSchema).max(50),
    candidateSearchComplete: z.literal(false), draftRef: z.string().uuid().optional(), revision: z.number().int().positive().optional() }).strict().optional(),
  artifact: z.object({ id: z.string().uuid(), type: z.literal('travel_guide'), schemaVersion: z.literal(1) }).strict().optional(),
  summary: z.object({ dayCount: z.number().int(), itemCount: z.number().int(), verificationStatus: z.string() }).strict().optional(),
  days: travelGuideArtifactPayloadSchema.shape.days.optional(),
  supportingEvidence: travelGuideArtifactPayloadSchema.shape.supportingEvidence,
  budget: travelGuideArtifactPayloadSchema.shape.budget,
  warnings: z.array(z.string().max(240)).max(40)
}).strict()

function classify(code: string): GuideRepairIssue['classification'] {
  if (/CONTEXT_VERSION|SELECTION|guide_draft_conflict/.test(code)) return 'context_conflict'
  if (/^guide_research_type:|guide_event_date_evidence_missing|eligible_research_evidence|verified_evidence|research_travel_window|supporting_evidence_(stale|unverified)/.test(code)) return 'evidence_missing'
  return 'draft_invalid'
}

async function availableCandidates(scope: ArtifactWorkspace, input: SaveGuideInput) {
  if (!tripDatesConsistent(scope.tripContext)) return []
  const selected = [...input.researchArtifactIds ?? [], ...(input.days ?? []).flatMap(day => day.items
    .flatMap(item => item.candidateRef ? [candidateArtifactId(item.candidateRef)] : [])),
  ...(input.supportingRefs ?? []).map(ref => typeof ref === 'string' ? candidateArtifactId(ref) : ref.researchArtifactId)]
  const records = new Map((await scope.artifacts.listForTrip?.(scope.tripId, 20) ?? []).map(record => [record.id, record]))
  for (const id of [...new Set(selected.filter((value): value is string => Boolean(value)))].slice(0, 20)) {
    if (!records.has(id)) { const record = await scope.artifacts.get(id); if (record) records.set(id, record) }
  }
  const window = tripTravelWindow(scope.tripContext)
  const result: z.infer<typeof guideCandidateSchema>[] = []
  for (const record of records.values()) {
    scope.signal?.throwIfAborted()
    if (record.tripId !== scope.tripId || record.type !== 'research' || record.schemaVersion !== 2) continue
    try { assertArtifactContextVersion(record, scope.tripContextVersion) } catch { continue }
    const parsed = researchArtifactSchema.safeParse(record.payload)
    if (!parsed.success || parsed.data.id !== record.id) continue
    const source = parsed.data
    if ((window?.from && (!source.brief.travelWindow?.from || source.brief.travelWindow.from > window.from))
      || (window?.to && (!source.brief.travelWindow?.to || source.brief.travelWindow.to < window.to))) continue
    result.push(...guideCandidates(scope, source).filter(candidate => {
      const finding = source.findings.find(value => value.id === candidate.findingId)!
      return ['verified', 'partially_verified'].includes(candidate.verificationStatus)
        && source.brief.researchTypes.includes(candidate.category) && finding.verification.sources.length > 0
        && finding.verification.sources.every(ref => finding.sources.some(value => value.url === ref.reference))
    }))
  }
  // Include supporting categories before filling the bounded response with activities.
  return result.sort((a, b) => Number(b.category === 'practical') - Number(a.category === 'practical')).slice(0, 50)
}

export const saveTravelGuideTool: AgentTool<SaveGuideInput, z.infer<typeof outputSchema>> = {
  name: 'save_travel_guide',
  description: 'Save your itinerary decisions with days[].items[].candidateRef from research/context/read_artifact. Choose cityId, theme, kind, timeOfDay and planningNote; the server restores facts and budget. supportingRefs is a separate array of candidate refs for practical evidence, not scheduled attractions. Legacy researchArtifactIds + researchIndex + findingId remains supported. On needs_revision use repair.draftRef + expectedRevision + replacementDays (only changed existing days) and/or supportingRefs (replaces all supports). Invalid refs are draft repairs: reuse availableCandidates before researching. Drafts live only in this generation; after restart submit full days. Do not mix candidateRef with legacy item fields. Recommendations must not invent source facts. Saved days, supportingEvidence and budget are authoritative for your reply.',
  inputSchema: saveGuideInputSchema, outputSchema,
  costClass: 'cheap', costUnits: 1, sideEffect: 'state', parallelSafe: false,
  timeoutMs: 15_000, provider: 'travel_guide',
  async execute(input, context, signal) {
    let constraints: TravelGuideConstraints = { maxCities: 12, maxResults: 20, researchTypes: ['activity'], allowPartial: true }
    if (context.goalRepository) {
      if (!context.activeGoalId || !context.activeGoalRunId) return {
        status: 'needs_revision', issues: ['active_travel_guide_goal_required'], warnings: [],
        revisionGuidance: 'Use resume_goal for the matching unfinished travel_guide Goal, or declare_goal for a new objective, before saving. Reading get_active_goal does not activate its run.'
      }
      const goal = await context.goalRepository.get(context.activeGoalId)
      if (!goal || goal.kind !== 'travel_guide') return { status: 'needs_revision', issues: ['active_travel_guide_goal_required'], warnings: [] }
      constraints = travelGuideGoalParametersSchema.parse(goal.parameters)
    }
    const { maxCities, maxResults, researchTypes, allowPartial, allowRestDays } = constraints
    const requirements = { maxCities, maxResults, researchTypes, requiredEvidenceTypes: requiredGuideEvidenceTypes(constraints),
      allowPartial, ...(allowRestDays === undefined ? {} : { allowRestDays }) }
    try {
      const scope = await workspaceScope(context, signal)
      const accepted = acceptGuideDraft(input, context, scope)
      const repair = async (errors: GuideRepairIssue[]) => ({ issues: errors.slice(0, 400),
        availableCandidates: await availableCandidates(scope, accepted.draft?.input ?? input), candidateSearchComplete: false as const,
        ...(accepted.draft ? { draftRef: accepted.draft.ref, revision: accepted.draft.revision } : {}) })
      if (accepted.errors) return { status: 'needs_revision', issues: accepted.errors.map(error => error.code), warnings: [], requirements,
        repair: await repair(accepted.errors) }
      const resolved = await resolveGuideDraft(accepted.draft, scope)
      if (resolved.errors.length) return { status: 'needs_revision', issues: [...new Set(resolved.errors.map(error => error.code))],
        requirements, warnings: [], feedbackTruncated: resolved.errors.length > 400,
        repair: await repair(resolved.errors), revisionGuidance: 'Correct reference fields using existing candidates. Evidence checks blocked by invalid references have not run; do not research to repair an index or reference.' }
      const result = await saveAuthoredTravelGuide(resolved.input, constraints, scope, [...context.resolvedLocations?.values() ?? []])
      if (result.status === 'needs_revision') return {
        ...result, issues: result.issues.slice(0, 400), ...(result.details ? { details: result.details.slice(0, 400) } : {}),
        feedbackTruncated: result.issues.length > 400 || (result.details?.length ?? 0) > 400,
        requirements, warnings: [], repair: await repair(result.issues.map(code => ({ code, classification: classify(code) }))),
        revisionGuidance: 'Keep the accepted Goal. Repair draft_invalid locally. For evidence_missing inspect availableCandidates and saved artifacts first; select practical evidence through supportingRefs. Research only genuinely missing evidence. context_conflict requires current state and a full draft.'
      }
      delete context.guideDraft
      return {
      status: 'saved', issues: [], requirements, artifact: { id: result.record.id, type: 'travel_guide', schemaVersion: 1 },
      summary: { dayCount: result.payload.days.length, itemCount: result.payload.days.reduce((sum, day) => sum + day.items.length, 0), verificationStatus: result.payload.verification.status },
      days: result.payload.days, warnings: result.payload.warnings,
      ...(result.payload.supportingEvidence ? { supportingEvidence: result.payload.supportingEvidence } : {}),
      ...(result.payload.budget ? { budget: result.payload.budget } : {})
      }
    } catch (error) {
      if (!isAppError(error) || !['TRIP_CONTEXT_VERSION_CONFLICT', 'ARTIFACT_CONTEXT_VERSION_MISMATCH', 'ARTIFACT_CONTEXT_VERSION_MISSING', 'FLIGHT_SELECTION_CHANGED'].includes(error.code)) throw error
      delete context.guideDraft
      return { status: 'needs_revision', issues: [error.code], warnings: [], requirements,
        repair: { issues: [{ code: error.code, classification: 'context_conflict' }], availableCandidates: [], candidateSearchComplete: false },
        revisionGuidance: 'The Trip or flight selection changed. Reload current state and submit a new full draft; stop writes from this old operation.' }
    }
  }
}
