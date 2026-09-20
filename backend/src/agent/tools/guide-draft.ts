import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import { canonicalFingerprint } from '../goals/repository.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { authoredGuideInputSchema, type AuthoredGuideInput } from '../../travel-guides/authored.js'
import { candidateRefSchema, resolveGuideCandidate } from '../../travel-guides/candidates.js'
import type { ArtifactWorkspace } from '../../artifacts/workspace.js'
import type { ResearchArtifact } from '../../research-agent/types.js'
import { isAppError } from '../../lib/errors.js'

const legacyDay = authoredGuideInputSchema.shape.days.element
const legacyItem = legacyDay.shape.items.element
const item = legacyItem.partial({ researchIndex: true, findingId: true }).extend({ candidateRef: candidateRefSchema.optional() }).strict()
const day = legacyDay.extend({ items: z.array(item).max(6) }).strict()
const supportingRef = z.union([candidateRefSchema, z.object({ researchArtifactId: z.string().uuid(), findingId: z.string().min(1).max(160) }).strict()])
export const saveGuideInputSchema = z.object({
  researchArtifactIds: authoredGuideInputSchema.shape.researchArtifactIds.optional(),
  days: z.array(day).min(1).max(60).optional(),
  supportingRefs: z.array(supportingRef).max(50).optional(),
  draftRef: z.string().uuid().optional(), expectedRevision: z.number().int().positive().optional(),
  replacementDays: z.array(day).min(1).max(60).optional()
}).strict()
export type SaveGuideInput = z.infer<typeof saveGuideInputSchema>
export type GuideRepairClass = 'draft_invalid' | 'evidence_missing' | 'context_conflict'
export interface GuideRepairIssue { code: string; classification: GuideRepairClass; fieldPath?: string; day?: number; blockedChecks?: string[] }
export interface GuideDraft { ref: string; revision: number; binding: string; input: SaveGuideInput }

export function acceptGuideDraft(input: SaveGuideInput, context: ToolExecutionContext, scope: ArtifactWorkspace):
  { draft: GuideDraft; errors?: never } | { errors: GuideRepairIssue[]; draft?: never } {
  const binding = canonicalFingerprint({ ownerId: context.ownerId, tripId: scope.tripId, version: scope.tripContextVersion,
    generationId: context.generationId, goalId: context.activeGoalId, runId: context.activeGoalRunId, selection: scope.selectedFlight?.selection })
  const invalid = (code: string, classification: GuideRepairClass = 'draft_invalid', fieldPath?: string) => ({
    errors: [{ code, classification, ...(fieldPath ? { fieldPath } : {}) }]
  })
  let full: SaveGuideInput
  let ref = uuidv7(), revision = 1
  if (input.draftRef !== undefined) {
    const prior = context.guideDraft
    if (!prior || prior.ref !== input.draftRef || prior.binding !== binding || prior.revision !== input.expectedRevision)
      return invalid('guide_draft_conflict', 'context_conflict', 'expectedRevision')
    if (input.days || input.researchArtifactIds || (!input.replacementDays && input.supportingRefs === undefined))
      return invalid('guide_patch_invalid', 'draft_invalid', 'replacementDays')
    const replacements = input.replacementDays ?? []
    if (new Set(replacements.map(value => value.day)).size !== replacements.length
      || replacements.some(value => !prior.input.days?.some(existing => existing.day === value.day)))
      return invalid('guide_patch_unknown_or_duplicate_day', 'draft_invalid', 'replacementDays')
    full = { ...structuredClone(prior.input),
      days: prior.input.days!.map(value => replacements.find(replacement => replacement.day === value.day) ?? value),
      ...(input.supportingRefs === undefined ? {} : { supportingRefs: input.supportingRefs }) }
    ref = prior.ref; revision = prior.revision + 1
  } else {
    if (!input.days || input.replacementDays || input.expectedRevision !== undefined)
      return invalid('guide_full_draft_required', 'draft_invalid', 'days')
    full = input
  }
  const draft = { ref, revision, binding, input: structuredClone(full) }
  context.guideDraft = draft
  return { draft }
}

/** Translate compact decisions to the unchanged domain input. Resolve all references before writing. */
export async function resolveGuideDraft(draft: GuideDraft, scope: ArtifactWorkspace) {
  const errors: GuideRepairIssue[] = []
  const cache = new Map<string, ResearchArtifact>()
  const researchArtifactIds = [...draft.input.researchArtifactIds ?? []]
  const resolve = async (ref: string, fieldPath: string) => {
    try {
      if (cache.size >= 20) {
        const sourceId = ref.split('.')[1]
        if (!sourceId || !cache.has(sourceId)) {
          errors.push({ code: 'guide_research_limit', classification: 'draft_invalid', fieldPath }); return undefined
        }
      }
      const value = await resolveGuideCandidate(ref, scope, cache)
      if (!value) errors.push({ code: 'guide_candidate_invalid', classification: 'draft_invalid', fieldPath,
        blockedChecks: ['evidence_identity', 'category_coverage', 'source_dates'] })
      return value
    } catch (error) {
      if (!isAppError(error) || !['RESOURCE_NOT_FOUND', 'ARTIFACT_TYPE_MISMATCH', 'ARTIFACT_CONTEXT_VERSION_MISMATCH', 'ARTIFACT_CONTEXT_VERSION_MISSING'].includes(error.code)) throw error
      errors.push({ code: error.code, classification: error.statusCode === 409 ? 'context_conflict' : 'draft_invalid', fieldPath,
        blockedChecks: ['evidence_identity', 'category_coverage', 'source_dates'] })
      return undefined
    }
  }
  const days: AuthoredGuideInput['days'] = []
  for (const [dayIndex, value] of draft.input.days!.entries()) {
    const items: AuthoredGuideInput['days'][number]['items'] = []
    for (const [itemIndex, selection] of value.items.entries()) {
      const path = `days[${dayIndex}].items[${itemIndex}]`
      const { candidateRef, researchIndex, findingId, ...decision } = selection
      if (candidateRef !== undefined) {
        if (researchIndex !== undefined || findingId !== undefined) {
          errors.push({ code: 'guide_mixed_reference', classification: 'draft_invalid', fieldPath: path }); continue
        }
        const ref = await resolve(candidateRef, `${path}.candidateRef`)
        if (!ref) continue
        if (!researchArtifactIds.includes(ref.researchArtifactId)) researchArtifactIds.push(ref.researchArtifactId)
        items.push({ ...decision, researchIndex: researchArtifactIds.indexOf(ref.researchArtifactId), findingId: ref.findingId })
      } else if (researchIndex !== undefined && findingId !== undefined && researchArtifactIds[researchIndex]) {
        items.push({ ...decision, researchIndex, findingId })
      } else errors.push({ code: 'guide_research_index', classification: 'draft_invalid', fieldPath: path,
        blockedChecks: ['evidence_identity', 'category_coverage', 'source_dates'] })
    }
    days.push({ ...value, items })
  }
  const supportingRefs: NonNullable<AuthoredGuideInput['supportingRefs']> = []
  for (const [index, value] of (draft.input.supportingRefs ?? []).entries()) {
    const ref = typeof value === 'string' ? await resolve(value, `supportingRefs[${index}]`) : value
    if (ref) supportingRefs.push(ref)
  }
  if (researchArtifactIds.length > 20) errors.push({ code: 'guide_research_limit', classification: 'draft_invalid', fieldPath: 'days' })
  if (!days.some(day => day.items.length) && errors.length === 0)
    errors.push({ code: 'guide_no_selected_findings', classification: 'draft_invalid', fieldPath: 'days' })
  return { errors, input: { researchArtifactIds, days, supportingRefs } as AuthoredGuideInput, sources: cache }
}
