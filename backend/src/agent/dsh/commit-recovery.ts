import { z } from 'zod'
import { AppError, isAppError } from '../../lib/errors.js'
import { researchTypeSchema } from '../../research-agent/types.js'
import { travelGuideGoalParametersSchema } from '../goals/types.js'
import { sanitizePresentationProblems } from './presentation-problems.js'

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
    if (['candidate_category_outside_goal', 'guide_initial_result_limit'].includes(code)) return 'arguments'
    if (code === 'candidate_temporal_evidence_missing') return 'prerequisite'
    if (code === 'candidate_temporal_evidence_invalid') return ['source_not_selected', 'unavailable'].includes(String(details.reason))
      ? 'prerequisite' : 'content'
    if (['candidate_evidence_unavailable', 'candidate_key_unavailable', 'candidate_location_unresolved',
      'candidate_goal_missing', 'guide_edit_prerequisite', 'activity_text_exact_cover', 'candidate_binding_invalid',
      'duplicate_day_or_activity_key', 'duplicate_candidate_key', 'raw_evidence_requires_partial',
      'guide_edit_result_limit', 'protected_slot_conflict', 'protected_supporting_evidence'].includes(code)) return 'prerequisite'
    if (['guide_edit_limit_conflict', 'guide_edit_limits_unavailable'].includes(code)) return 'prerequisite'
    return 'content'
  }
  if (['ARTIFACT_CONTEXT_VERSION_MISMATCH', 'TRIP_CONTEXT_VERSION_CONFLICT', 'FLIGHT_SELECTION_CHANGED',
    'DSH_CANDIDATE_REFERENCE_UNAVAILABLE'].includes(error.code)) return 'prerequisite'
  return 'system'
}

/** Model-visible feedback is assembled from known fields; provider messages and arbitrary details never cross this boundary. */
export function safeCommitFeedback(error: unknown, kind: CommitFailureKind, options: { acceptedGoal?: boolean } = {}) {
  const details = isAppError(error) && error.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details as Record<string, unknown> : {}
  const acceptedGoal = options.acceptedGoal === true
  const goalAcceptanceKnown = options.acceptedGoal !== undefined
  const goalCorrection = goalAcceptanceKnown
    ? acceptedGoal ? 'The Goal is accepted; omit intent/goalRef and preserve its immutable constraints.'
      : 'No Goal is accepted yet; preserve the original semantic intent on the corrected first durable submission.'
    : 'If a Goal is accepted, omit intent/goalRef and preserve its immutable constraints; otherwise preserve the original intent on the first durable submission.'
  const strings = (value: unknown, limit = 30) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, limit) : []
  const code = isAppError(error) ? error.code : error instanceof z.ZodError ? 'INVALID_ARGUMENTS' : 'DSH_TOOL_FAILURE'
  const feedback: Record<string, unknown> = { code, kind, instruction: ['DSH_COMMIT_CALL_LIMIT', 'DSH_ARGUMENT_CORRECTION_LIMIT', 'DSH_REPAIR_LIMIT'].includes(code)
    ? 'The bounded submission allowance is exhausted. Do not submit again in this turn; no publication is implied. Report the last failed delivery.'
    : code === 'GOAL_INTENT_REQUIRED'
    ? 'The first durable operation requires semantic intent matching the explicit user objective. Include the original intent on this corrected first submission.'
    : code === 'DSH_CANDIDATE_REFERENCE_UNAVAILABLE'
    ? 'Correct the indicated reference field: candidateRef/supportingRefs accept only candidate references returned in this preparation, not source URLs. For submitted supplemental candidates use supportingCandidateKeys. Do not invent or drop required evidence. If no Goal was accepted, the corrected first submission still needs its semantic intent; otherwise preserve the accepted immutable Goal and omit intent/goalRef.'
    : code === 'GOAL_INTENT_CONFLICT' || code === 'GOAL_IDEMPOTENCY_CONFLICT'
    ? 'The accepted Goal constraints are immutable. For its repair, omit intent/goalRef and preserve those constraints; do not weaken or replace the objective.'
    : kind === 'arguments'
    ? `Correct only the stated commit fields. ${goalCorrection} Current-turn candidates and evidence remain available.`
    : kind === 'prerequisite' ? 'Correct the missing or stale prerequisite before resubmitting. Reuse current-turn candidates and evidence when their scope is unchanged.'
      : kind === 'content' ? 'Revise the rejected itinerary or public text once, preserving the accepted Goal and protected slots.'
        : 'The guide submission could not be processed. Do not infer acceptance.' }
  if (code === 'DSH_GUIDE_NEEDS_REVISION' && details.code === 'guide_initial_result_limit') {
    feedback.revisionCode = details.code
    feedback.fields = ['intent.parameters.maxResults']
    // Up to 360 visits, 50 persisted supports and 50 new supports in the existing input schema.
    if (Number.isInteger(details.selectedFindingCount) && Number(details.selectedFindingCount) >= 0 && Number(details.selectedFindingCount) <= 460)
      feedback.selectedFindingCount = details.selectedFindingCount
    if (travelGuideGoalParametersSchema.shape.maxResults.safeParse(details.maxResults).success) feedback.maxResults = details.maxResults
    feedback.maxAllowedResults = travelGuideGoalParametersSchema.shape.maxResults.maxValue
    feedback.correction = 'No Goal has been accepted in this turn. The count covers all distinct scheduled and supporting findings across the complete guide; different findings may share one raw source. For a NEW first intent, explicitly correct maxResults to cover that count within maxAllowedResults only when consistent with the user request; keep its semantic scope and all other constraints. Do not silently drop required visits or supporting evidence, add already scheduled findings to supportingRefs, invent candidates, or change a previously accepted/resumed Goal. A corrected first submission still needs its explicit semantic intent (or the unchanged resumable goalRef) and complete candidate definitions. If the complete required selection cannot fit the legal or previously accepted limit, report the constraint without claiming publication.'
  }
  if (code === 'DSH_GUIDE_NEEDS_REVISION' && ['guide_edit_result_limit', 'guide_edit_limit_conflict', 'guide_edit_limits_unavailable'].includes(String(details.code))) {
    feedback.revisionCode = details.code
    if (Number.isInteger(details.selectedFindingCount) && Number(details.selectedFindingCount) >= 0 && Number(details.selectedFindingCount) <= 410)
      feedback.selectedFindingCount = details.selectedFindingCount
    if (Number.isInteger(details.maxResults) && Number(details.maxResults) >= 1 && Number(details.maxResults) <= 20) feedback.maxResults = details.maxResults
    feedback.correction = 'For a compact slot edit, omit maxResults/maxCities and keep the explicit semantic intent. The server must carry the exact prepared base Goal limits. Never remove protected findings or change an accepted Goal to fit a replacement. If the base contract is unavailable or cannot cover the complete edited guide, stop this edit without claiming publication.'
  }
  if (code === 'DSH_GUIDE_NEEDS_REVISION' && details.code === 'duplicate_day_or_activity_key') {
    const submitted = Array.isArray(details.days) ? details.days.slice(0, 60) : []
    const seen = new Set<number>()
    const duplicateDayNumbers = new Set<number>()
    const fields: string[] = []
    const submittedDayNumbers: number[] = []
    submitted.forEach((day, index) => {
      if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 60) return
      submittedDayNumbers.push(day)
      if (seen.has(day)) { duplicateDayNumbers.add(day); fields.push(`days.${index}.day`) }
      seen.add(day)
    })
    if (submittedDayNumbers.length) feedback.submittedDayNumbers = submittedDayNumbers
    if (duplicateDayNumbers.size) { feedback.duplicateDayNumbers = [...duplicateDayNumbers]; feedback.fields = fields }
    feedback.correction = 'Keep one entry per day number, with its selected visits in that entry\'s items. Choose which optional alternative is actually scheduled; do not invent a rest day or renumber an extra day to bypass the duplicate. Do not silently drop user-required activities. Each scheduled visit must also use a distinct activity/candidate binding. Keep the accepted trip duration, Goal, evidence and protected slots unchanged.'
  }
  if (code === 'DSH_GUIDE_NEEDS_REVISION' && ['candidate_temporal_evidence_missing', 'candidate_temporal_evidence_invalid'].includes(String(details.code))) {
    const index = details.candidateIndex
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < 50
      && details.fieldPath === `candidates.${index}.temporalEvidence`) {
      feedback.candidateIndex = index
      feedback.fields = [details.fieldPath]
    }
    if (['missing', 'source_not_selected', 'unavailable', 'quote_not_found', 'date_mismatch'].includes(String(details.reason)))
      feedback.reason = details.reason
    feedback.correction = 'Supply an exact occurrence-date quote from an available source selected by this candidate, plus its matching from/to dates and current sourceRef. Never use a page publication date, query window or expiry date as the event date. Do not relabel an event or invent a quote to bypass validation. Select a supported visit that meets the unchanged user request, or explain a genuine source gap. Keep the accepted Goal, trip dates and protected slots unchanged.'
  }
  if (kind === 'arguments' && error instanceof z.ZodError) {
    feedback.fields = error.issues.slice(0, 20).map(issue => issue.path.join('.'))
    if (error.issues.some(issue => issue.path.includes('sourceRefs'))) feedback.correction =
      'For new candidates select only sourceRefs returned by web_search/web_fetch in this current preparation, not URLs. Reuse the existing current receipts; do not invent references or repeat valid research.'
    else if (error.issues.some(issue => issue.path.includes('candidateRef') || issue.path.includes('supportingRefs'))) feedback.correction =
      'Select only persisted candidate references returned in this preparation for candidateRef/supportingRefs, not source URLs. For new supplemental candidates use supportingCandidateKeys.'
    const categoryFields = error.issues.filter(issue => issue.path.length === 3 && issue.path[0] === 'candidates'
      && Number.isInteger(issue.path[1]) && Number(issue.path[1]) >= 0 && Number(issue.path[1]) < 50
      && issue.path[2] === 'category').map(issue => issue.path.join('.'))
    if (categoryFields.length) {
      feedback.fields = [...new Set([...(feedback.fields as string[]), ...categoryFields])]
      feedback.allowedCategories = [...researchTypeSchema.options]
      feedback.correction = 'Provide a research category at each indicated field using allowedCategories. Classify candidates from their evidence; do not relabel or remove candidates to satisfy a requirement.'
    }
  }
  if (code === 'DSH_GUIDE_NEEDS_REVISION' && details.code === 'candidate_category_outside_goal') {
    const categories = new Set(['event', 'seasonal', 'activity', 'stopover', 'practical'])
    const candidateIndex = details.candidateIndex
    const fieldPath = details.fieldPath
    if (Number.isInteger(candidateIndex) && Number(candidateIndex) >= 0 && Number(candidateIndex) < 50
      && fieldPath === `candidates.${candidateIndex}.category`) {
      feedback.candidateIndex = candidateIndex
      feedback.fieldPath = fieldPath
    }
    const allowedCategories = strings(details.allowedCategories).filter(value => categories.has(value)).slice(0, 5)
    if (allowedCategories.length) feedback.allowedCategories = allowedCategories
    feedback.correction = 'Keep the accepted Goal unchanged. Submit only candidates whose actual category is in allowedCategories; do not relabel unsupported material. Correct or replace the indicated candidate explicitly, using current-turn evidence where needed.'
  }
  if (code === 'DSH_GUIDE_NEEDS_REVISION' && details.code === 'candidate_location_unresolved') {
    const fieldPattern = /^(?:candidates\.(\d+)\.locationId|days\.(\d+)\.cityId)$/
    const fields: string[] = []
    const seenFields = new Set<string>()
    if (Array.isArray(details.fieldPaths)) for (const value of details.fieldPaths) {
      if (typeof value !== 'string' || seenFields.has(value)) continue
      const match = fieldPattern.exec(value)
      if (!match || match[0] !== value) continue
      const candidateIndex = match[1] === undefined ? undefined : Number(match[1])
      const dayIndex = match[2] === undefined ? undefined : Number(match[2])
      if (candidateIndex !== undefined && (candidateIndex >= 50 || String(candidateIndex) !== match[1])
        || dayIndex !== undefined && (dayIndex >= 60 || String(dayIndex) !== match[2])) continue
      seenFields.add(value)
      fields.push(value)
      if (fields.length === 110) break
    }
    if (fields.length) feedback.fields = [...new Set(fields)]
    if (['open', 'explicit', 'mixed'].includes(String(details.destinationMode))) feedback.destinationMode = details.destinationMode
    if (Number.isInteger(details.selectedCityCount) && Number(details.selectedCityCount) >= 0 && Number(details.selectedCityCount) <= 99)
      feedback.selectedCityCount = Number(details.selectedCityCount)
    feedback.revisionCode = 'candidate_location_unresolved'
    feedback.correction = 'For each omitted field, explicitly select a matching canonical city already confirmed in the current Trip when one is available; never infer a candidate location from another day cityId or text. If no current Trip city identifies the requested place, ask the user to confirm it. Use the trusted location resolver and update_trip_context only when a new destination is supported by the user request; do not collapse an existing multi-city Trip to one city. After the Trip version advances to a new version, prepare again and repeat research; old sourceRefs and candidate bindings belong to the previous Trip version and must not be reused.'
  }
  if (details.code === 'candidate_key_unavailable') {
    const fieldPath = details.fieldPath === 'candidates' ? 'candidates' : undefined
    const registrationStatus = ['not_submitted', 'submitted_incomplete'].includes(String(details.registrationStatus))
      ? details.registrationStatus as 'not_submitted' | 'submitted_incomplete' : undefined
    const missingCandidateKeys = strings(details.missingCandidateKeys, 50).map(value => value.slice(0, 120))
    const availableCandidateKeys = strings(details.availableCandidateKeys, 50).map(value => value.slice(0, 120))
    if (fieldPath) feedback.fieldPath = fieldPath
    if (registrationStatus) feedback.registrationStatus = registrationStatus
    if (missingCandidateKeys.length) feedback.missingCandidateKeys = missingCandidateKeys
    feedback.availableCandidateKeys = availableCandidateKeys
    feedback.correction = registrationStatus === 'not_submitted' && availableCandidateKeys.length === 0
      ? 'No candidates are registered for this prepared attempt. Add candidates entries for every missingCandidateKeys value, using an explicit key and current-turn sourceRefs returned by web_search/web_fetch. Then use those exact keys in the scheduled items. Web source receipts are not candidate definitions; do not invent or rename keys to bypass registration.'
      : registrationStatus === 'not_submitted'
        ? 'Only availableCandidateKeys are registered in this prepared attempt. Use one of those exact keys, or explicitly submit a complete candidates list that defines each missingCandidateKeys value with supported details and current-turn sourceRefs returned by web_search/web_fetch. Do not merely rename a scheduled key.'
        : 'The submitted candidate list replaces the earlier registration and does not define every selected key. Complete candidates with each missingCandidateKeys value, its supported title/summary/category/locationId, and current-turn sourceRefs returned by web_search/web_fetch. Use the exact defined keys in scheduled items. Do not invent or rename keys to bypass registration.'
  }
  if (code === 'DSH_CANDIDATE_REFERENCE_UNAVAILABLE' && typeof details.fieldPath === 'string'
    && /^(?:supportingRefs\.\d{1,3}|days\.\d{1,3}\.items\.\d{1,3}\.candidateRef)$/.test(details.fieldPath)) {
    feedback.fields = [details.fieldPath]
  }
  if (kind === 'content' || kind === 'prerequisite') {
    const presentationProblems = sanitizePresentationProblems(details.presentationProblems)
    if (presentationProblems.length) feedback.presentationProblems = presentationProblems
    if (details.code === 'raw_evidence_requires_partial') {
      feedback.fields = ['intent.parameters.allowPartial']
      feedback.correction = 'No Goal has been accepted for this submission. New raw-web candidates are partially verified, reference-only material. Correct the first intent to allowPartial=true only if this matches the user request. If the user requires independently verified facts, explain that these sources cannot satisfy that requirement and clarify; do not silently weaken the requested objective or an accepted Goal. Reuse current evidence and repair public text without repeating valid research.'
    }
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
    const coverage = details.dayCoverage && typeof details.dayCoverage === 'object' && !Array.isArray(details.dayCoverage)
      ? details.dayCoverage as Record<string, unknown> : undefined
    if (coverage && Number.isInteger(coverage.expectedDays) && Number(coverage.expectedDays) >= 1 && Number(coverage.expectedDays) <= 60
      && Array.isArray(coverage.submittedDays) && coverage.submittedDays.length <= 60
      && coverage.submittedDays.every(day => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 60)) {
      const window = coverage.travelWindow && typeof coverage.travelWindow === 'object' && !Array.isArray(coverage.travelWindow)
        ? coverage.travelWindow as Record<string, unknown> : undefined
      const isDate = (value: unknown): value is string => typeof value === 'string' && z.iso.date().safeParse(value).success
      const windowValid = window && Object.keys(window).every(key => key === 'from' || key === 'to')
        && (window.from === undefined || isDate(window.from)) && (window.to === undefined || isDate(window.to))
      const travelWindow = windowValid && window && (window.from !== undefined || window.to !== undefined)
        ? { ...(isDate(window.from) ? { from: window.from } : {}), ...(isDate(window.to) ? { to: window.to } : {}) }
        : undefined
      feedback.dayCoverage = { expectedDays: Number(coverage.expectedDays), submittedDays: coverage.submittedDays,
        ...(travelWindow ? { travelWindow } : {}) }
    }
    const contentCorrections: string[] = []
    if (strings(details.issues).includes('guide_duplicate_evidence')) contentCorrections.push(
      'Use a distinct candidate/finding for each scheduled visit and supporting item. One current source may support several truly distinct places; do not rename the same visit. Keep accepted Goal constraints and protected slots unchanged.')
    if (strings(details.presentationIssues).includes('excluded_precise_claim')) contentCorrections.push(
      'Remove unsupported prices, clock times and precise durations from public text. You may retain the exact current trip budget amount only as a total-trip target; do not claim that costs fit it.')
    if (strings(details.presentationIssues).includes('budget_scope_changed')
      || sanitizePresentationProblems(details.presentationProblems).some(problem => problem.code === 'budget_scope_changed')) contentCorrections.push(
      'Keep the authoritative whole-trip budget scope. Remove invented expense exclusions or separate-counting claims; self-purchased flights do not authorize narrowing it. Unknown costs remain unknown.')
    if (details.code === 'activity_text_exact_cover') contentCorrections.push(
      'Provide exactly one text activity per requiredActivityKey. Put practical material in supportingCandidateKeys, not text.activities.')
    if (contentCorrections.length) feedback.correction = [typeof feedback.correction === 'string' ? feedback.correction : undefined,
      ...contentCorrections].filter(Boolean).join(' ')
  }
  if (goalAcceptanceKnown && !acceptedGoal) {
    feedback.instruction = `${feedback.instruction} No Goal has been accepted in this turn; preserve the original semantic intent on the corrected first durable submission.`
  }
  const coverage = feedback.dayCoverage as { expectedDays?: number } | undefined
  if (coverage) {
    const correction = `Submit exactly ${coverage.expectedDays} sequential day(s) for the current Trip window, with the complete corrected days and text. Do not add optional days outside the Trip.`
    feedback.correction = [correction, typeof feedback.correction === 'string' ? feedback.correction : undefined].filter(Boolean).join(' ')
  }
  return feedback
}
