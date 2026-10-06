import { z } from 'zod'
import { AppError, isAppError } from '../../lib/errors.js'

export type CommitFailureKind = 'arguments' | 'prerequisite' | 'content' | 'system'
const MAX_CALLS = 6
const MAX_ARGUMENT_CORRECTIONS = 3
const MAX_CONTENT_ATTEMPTS = 2

/** Counts attempted tool calls separately from complete, evaluable guide submissions. */
export class CommitRecovery {
  calls = 0
  argumentCorrections = 0
  contentAttempts = 0
  lastFailure: CommitFailureKind | undefined

  admit(): void {
    if (this.calls >= MAX_CALLS) throw new AppError('DSH_COMMIT_CALL_LIMIT', 'Guide submission limit reached', 422)
    if (this.argumentCorrections >= MAX_ARGUMENT_CORRECTIONS)
      throw new AppError('DSH_ARGUMENT_CORRECTION_LIMIT', 'Guide argument correction limit reached', 422)
    if (this.contentAttempts >= MAX_CONTENT_ATTEMPTS)
      throw new AppError('DSH_REPAIR_LIMIT', 'Only one guide content repair is allowed per turn', 422)
    this.calls++
  }

  accepted(): void { this.contentAttempts++; this.lastFailure = undefined }

  failed(error: unknown): CommitFailureKind {
    const kind = classifyCommitFailure(error)
    this.lastFailure = kind
    if (kind === 'arguments') this.argumentCorrections++
    if (kind === 'content') this.contentAttempts++
    return kind
  }

  snapshot() { return { calls: this.calls, argumentCorrections: this.argumentCorrections, contentAttempts: this.contentAttempts,
    ...(this.lastFailure ? { lastFailure: this.lastFailure } : {}) } }
}

export function classifyCommitFailure(error: unknown): CommitFailureKind {
  if (error instanceof z.ZodError) return 'arguments'
  if (!isAppError(error)) return 'system'
  if (['GOAL_INTENT_REQUIRED', 'GOAL_INTENT_CONFLICT', 'GOAL_IDEMPOTENCY_CONFLICT'].includes(error.code)) return 'arguments'
  if (['DSH_GUIDE_NEEDS_REVISION'].includes(error.code)) {
    const details = error.details && typeof error.details === 'object' && !Array.isArray(error.details)
      ? error.details as Record<string, unknown> : {}
    const code = typeof details.code === 'string' ? details.code : ''
    if (['candidate_evidence_unavailable', 'candidate_key_unavailable', 'candidate_location_unresolved',
      'candidate_goal_missing', 'guide_edit_prerequisite', 'activity_text_exact_cover', 'candidate_binding_invalid',
      'duplicate_day_or_activity_key', 'duplicate_candidate_key'].includes(code)) return 'prerequisite'
    return 'content'
  }
  if (['ARTIFACT_CONTEXT_VERSION_MISMATCH', 'TRIP_CONTEXT_VERSION_CONFLICT', 'FLIGHT_SELECTION_CHANGED',
    'DSH_CANDIDATE_REFERENCE_UNAVAILABLE'].includes(error.code)) return 'prerequisite'
  return 'system'
}

/** Model-visible feedback is assembled from known fields; provider messages and arbitrary details never cross this boundary. */
export function safeCommitFeedback(error: unknown, kind: CommitFailureKind) {
  const details = isAppError(error) && error.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details as Record<string, unknown> : {}
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 30) : []
  const code = isAppError(error) ? error.code : error instanceof z.ZodError ? 'INVALID_ARGUMENTS' : 'DSH_TOOL_FAILURE'
  const feedback: Record<string, unknown> = { code, kind, instruction: code === 'GOAL_INTENT_REQUIRED'
    ? 'The first durable operation of this prepared attempt requires a new semantic intent matching the explicit user objective.'
    : code === 'DSH_CANDIDATE_REFERENCE_UNAVAILABLE'
    ? 'Correct the indicated reference field: candidateRef/supportingRefs accept only candidate references returned in this preparation, not source URLs. For submitted supplemental candidates use supportingCandidateKeys. Do not invent or drop required evidence. If no Goal was accepted, the corrected first submission still needs its semantic intent; otherwise preserve the accepted immutable Goal and omit intent/goalRef.'
    : code === 'GOAL_INTENT_CONFLICT' || code === 'GOAL_IDEMPOTENCY_CONFLICT'
    ? 'The accepted Goal constraints are immutable. For its repair, omit intent/goalRef and preserve those constraints; do not weaken or replace the objective.'
    : kind === 'arguments'
    ? 'Correct only the stated commit fields. If a Goal is already accepted, omit intent/goalRef and preserve its immutable constraints. Current-turn candidates and evidence remain available.'
    : kind === 'prerequisite' ? 'Correct the missing or stale prerequisite before resubmitting. Reuse current-turn candidates and evidence when their scope is unchanged.'
      : kind === 'content' ? 'Revise the rejected itinerary or public text once, preserving the accepted Goal and protected slots.'
        : 'The guide submission could not be processed. Do not infer acceptance.' }
  if (kind === 'arguments' && error instanceof z.ZodError) {
    feedback.fields = error.issues.slice(0, 20).map(issue => issue.path.join('.'))
    if (error.issues.some(issue => issue.path.includes('sourceRefs'))) feedback.correction =
      'For new candidates select only sourceRefs returned by web_search/web_fetch in this current preparation, not URLs. Reuse the existing current receipts; do not invent references or repeat valid research.'
    else if (error.issues.some(issue => issue.path.includes('candidateRef') || issue.path.includes('supportingRefs'))) feedback.correction =
      'Select only persisted candidate references returned in this preparation for candidateRef/supportingRefs, not source URLs. For new supplemental candidates use supportingCandidateKeys.'
  }
  if (code === 'DSH_CANDIDATE_REFERENCE_UNAVAILABLE' && typeof details.fieldPath === 'string'
    && /^(?:supportingRefs\.\d{1,3}|days\.\d{1,3}\.items\.\d{1,3}\.candidateRef)$/.test(details.fieldPath)) {
    feedback.fields = [details.fieldPath]
  }
  if (kind === 'content' || kind === 'prerequisite') {
    for (const field of ['code', 'requiredActivityKeys', 'submittedActivityKeys', 'unexpectedActivityKeys',
      'missingActivityKeys', 'duplicateActivityKeys', 'issues', 'presentationIssues'] as const) {
      if (field === 'code') { if (typeof details.code === 'string') feedback.revisionCode = details.code }
      else { const values = strings(details[field]); if (values.length) feedback[field] = values }
    }
    const publicationCodes = new Set(['missing_material', 'conflict', 'invalid_plan', 'language', 'format', 'timeout',
      'cancelled', 'stale', 'provider_failure', 'context_budget'])
    if (Array.isArray(details.issues)) {
      const publicationIssues = details.issues.slice(0, 30).flatMap(value => {
        const issue = value && typeof value === 'object' ? value as Record<string, unknown> : {}
        return typeof issue.code === 'string' && publicationCodes.has(issue.code)
          ? [{ code: issue.code, ...(typeof issue.activityId === 'string' ? { activityId: issue.activityId.slice(0, 160) } : {}) }] : []
      })
      if (publicationIssues.length) feedback.publicationIssues = publicationIssues
      if (details.issues.some(value => value && typeof value === 'object' &&
        typeof (value as Record<string, unknown>).detail === 'string' &&
        (value as Record<string, unknown>).detail!.toString().split(', ').includes('excluded_precise_claim'))) {
        feedback.correction = 'Remove unsupported prices, clock times and precise durations from public text. You may retain the exact current trip budget amount only as a total-trip target; do not claim that costs fit it.'
      }
    }
    if (typeof details.candidateKey === 'string') feedback.candidateKey = details.candidateKey.slice(0, 120)
    if (Array.isArray(details.details)) feedback.locations = details.details.slice(0, 20).map(value => {
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return { ...(typeof item.code === 'string' ? { code: item.code.slice(0, 80) } : {}),
        ...(Number.isInteger(item.day) && Number(item.day) >= 1 && Number(item.day) <= 60 ? { day: item.day } : {}),
        ...(typeof item.fieldPath === 'string' ? { fieldPath: item.fieldPath.slice(0, 160) } : {}),
        ...(typeof item.location === 'string' ? { location: item.location.slice(0, 160) } : {}) }
    })
    if (Array.isArray(details.replaceSlots)) feedback.protectedSlots = details.replaceSlots.slice(0, 30).flatMap(value => {
      const slot = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return Number.isInteger(slot.day) && Number(slot.day) >= 1 && Number(slot.day) <= 60
        && ['morning', 'afternoon', 'evening', 'flexible'].includes(String(slot.slot)) ? [{ day: slot.day, slot: slot.slot }] : []
    })
    for (const field of ['activityKeys', 'candidateKeys'] as const) {
      const values = strings(details[field]); if (values.length) feedback[field] = values
    }
    if (Array.isArray(details.candidates)) feedback.candidates = details.candidates.slice(0, 20).map(value => {
      const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return { ...(typeof candidate.candidateKey === 'string' ? { candidateKey: candidate.candidateKey } : {}),
        ...(strings(candidate.unavailableEvidenceRefs).length ? { unavailableEvidenceRefs: strings(candidate.unavailableEvidenceRefs) } : {}) }
    })
    if (details.repair && typeof details.repair === 'object') {
      const repair = details.repair as Record<string, unknown>
      feedback.repair = { issues: Array.isArray(repair.issues) ? repair.issues.slice(0, 30).map(value => {
        const issue = value && typeof value === 'object' ? value as Record<string, unknown> : {}
        return { ...(typeof issue.code === 'string' ? { code: issue.code.slice(0, 80) } : {}),
          ...(typeof issue.classification === 'string' ? { classification: issue.classification.slice(0, 40) } : {}),
          ...(Number.isInteger(issue.day) && Number(issue.day) >= 1 && Number(issue.day) <= 60 ? { day: issue.day } : {}),
          ...(typeof issue.fieldPath === 'string' ? { fieldPath: issue.fieldPath.slice(0, 160) } : {}) }
      }) : [], candidateSearchComplete: repair.candidateSearchComplete === true,
      availableCandidates: Array.isArray(repair.availableCandidates) ? repair.availableCandidates.slice(0, 30).map(value => {
        const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
        return { ...(typeof candidate.candidateRef === 'string' ? { candidateRef: candidate.candidateRef.slice(0, 160) } : {}),
          ...(typeof candidate.title === 'string' ? { title: candidate.title.slice(0, 240) } : {}),
          ...(typeof candidate.category === 'string' ? { category: candidate.category.slice(0, 40) } : {}),
          cityIds: strings(candidate.cityIds).slice(0, 12) }
      }) : [] }
    }
    if (strings(details.issues).includes('guide_duplicate_evidence')) feedback.correction =
      'Use a distinct candidate/finding for each scheduled visit and supporting item. One current source may support several truly distinct places; do not rename the same visit. Keep accepted Goal constraints and protected slots unchanged.'
    else if (strings(details.presentationIssues).includes('excluded_precise_claim')) feedback.correction =
      'Remove unsupported prices, clock times and precise durations from public text. You may retain the exact current trip budget amount only as a total-trip target; do not claim that costs fit it.'
    else if (details.code === 'activity_text_exact_cover') feedback.correction =
      'Provide exactly one text activity per requiredActivityKey. Put practical material in supportingCandidateKeys, not text.activities.'
  }
  return feedback
}
