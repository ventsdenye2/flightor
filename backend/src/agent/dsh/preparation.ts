import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import type { ArtifactRecord, GuideBaseCondition } from '../../artifacts/repository.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { candidateArtifactId } from '../../travel-guides/candidates.js'
import type { TripContext } from '../../trips/types.js'
import type { SelectedFlightContext } from '../../workspaces/flight-selection.js'
import type { PublicationLocale } from '../../travel-guides/finalization-schema.js'
import { commitGuideInputSchema, type CommitGuideInput } from './commit-guide.js'
import { dshCandidateTemporalEvidenceSchema } from './evidence.js'
import { uniqueSelectedTripCity } from './city-preparation.js'
import { travelGuideGoalParametersSchema } from '../goals/types.js'
import type { GoalRepository } from '../goals/repository.js'

/** Captured before the model runs; never refreshed from a newer draft at commit. */
export interface DshPreparation {
  trip: TripContext
  baseGuide?: GuideBaseCondition
  editLimits?: { maxResults: number; maxCities: number }
}

/** One owner-scoped read of the exact base lineage; never a default or a newer Goal. */
export async function bindPreparedEditLimits(preparation: DshPreparation, records: readonly ArtifactRecord[],
  goals: GoalRepository | undefined, ownerId: string, signal: AbortSignal): Promise<DshPreparation> {
  const base = records.find(record => record.id === preparation.baseGuide?.id)
  if (!goals || !base?.goalId || base.tripId !== preparation.trip.id || base.tripContextVersion !== preparation.trip.version) return preparation
  const publication = publicationFor(base)
  if (publication?.guideContentHash !== preparation.baseGuide?.contentHash
    || publication?.finalization?.variants[preparation.baseGuide!.locale]?.status !== 'accepted') return preparation
  const goal = await goals.get(base.goalId)
  signal.throwIfAborted()
  if (!goal || goal.ownerId !== ownerId || goal.tripId !== base.tripId || goal.conversationId !== base.conversationId
    || goal.kind !== 'travel_guide' || goal.createdContextVersion !== base.tripContextVersion) return preparation
  const parameters = travelGuideGoalParametersSchema.safeParse(goal.parameters)
  return parameters.success ? { ...preparation, editLimits: {
    maxResults: parameters.data.maxResults, maxCities: parameters.data.maxCities
  } } : preparation
}

export const dshCommitIntentSchema = z.object({ kind: z.literal('travel_guide'), parameters: z.object({
  ...travelGuideGoalParametersSchema.shape,
  maxResults: travelGuideGoalParametersSchema.shape.maxResults.optional()
    .describe('Required for a new full guide. For an accepted-guide slot edit, omit: the server carries the exact prepared base Goal limit, including protected supporting findings.'),
  maxCities: travelGuideGoalParametersSchema.shape.maxCities.optional()
    .describe('Required for a new full guide. For an accepted-guide slot edit, omit: the server carries the exact prepared base Goal limit.')
}).strict() }).strict()

export function prepareDshSnapshot(input: { trip: TripContext; records: readonly ArtifactRecord[];
  conversationId: string; selectedFlight: SelectedFlightContext | null; locale: PublicationLocale }): DshPreparation {
  const latest = input.records.filter(record => record.type === 'travel_guide' && record.tripId === input.trip.id
    && record.conversationId === input.conversationId && record.tripContextVersion === input.trip.version)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).find(record => {
    const publication = publicationFor(record)
    return Object.values(publication?.finalization?.variants ?? {}).some(variant => variant?.status === 'accepted')
  })
  const latestPublication = latest && publicationFor(latest)
  // A missing locale or changed flight on the newest guide must not silently
  // select an older itinerary that publication CAS will correctly reject.
  const base = latestPublication?.finalization?.variants[input.locale]?.status === 'accepted'
    && Boolean(latestPublication.finalization.variants[input.locale]?.text)
    && latestPublication.flightSelectionRevision === input.selectedFlight?.selection.revision ? latest : undefined
  const publication = base && publicationFor(base)
  return { trip: structuredClone(input.trip), ...(base && publication ? {
    baseGuide: { id: base.id, contentHash: publication.guideContentHash, locale: input.locale }
  } : {}) }
}

const activity = commitGuideInputSchema.shape.text.shape.activities.element.omit({ activityKey: true })
const sourceReference = z.string().min(1).max(160).refine(value =>
  value.startsWith('s1.') || z.string().uuid().safeParse(value).success,
  'Select a source receipt returned in the current preparation, not a source URL.')
const candidateReference = z.string().min(1).max(160).refine(value =>
  /^C-[a-f0-9]{10}-[1-9]\d*$/.test(value) || Boolean(candidateArtifactId(value)),
  'Select a candidate reference returned in the current preparation, not a source URL.')
  .describe('Only persisted candidate references returned by the current snapshot/read_artifact. Never source URLs or new candidate keys.')
const item = commitGuideInputSchema.shape.days.element.shape.items.element.omit({ activityKey: true })
  .extend({ candidateKey: z.string().trim().min(1).max(120).optional()
    .describe('Select only a key explicitly defined by candidates[].key in this submission or already registered in this same prepared attempt and scope. Every new candidateKey needs a candidates entry with current-turn sourceRefs; web_search/web_fetch receipts do not register candidates. Do not rename a missing key.'),
    candidateRef: candidateReference.optional(), text: activity }).strict()
/** DSH-only model contract. The legacy domain and frontend contracts stay intact. */
export const dshCommitInputSchema = commitGuideInputSchema.omit({ baseGuideId: true, expectedContentHash: true, days: true, text: true, candidates: true })
  .extend({ candidates: z.array(z.object({ key: z.string().trim().min(1).max(120), sourceRefs: z.array(sourceReference).min(1).max(20)
      .describe('Select only sourceRefs returned by web_search/web_fetch in this turn after the latest Trip update; never source URLs or invented IDs.'),
      title: z.string().trim().min(1).max(240), summary: z.string().trim().min(1).max(1500),
      category: z.enum(['event', 'seasonal', 'activity', 'stopover', 'practical']),
      temporalEvidence: dshCandidateTemporalEvidenceSchema.optional()
        .describe('For a selected event, bind one current sourceRef and copy the exact occurrence date range from its retrieved snippet or hash-verified fetched body. Metadata dates and source URLs are not occurrence evidence.'),
      locationId: z.string().min(1).max(160).optional()
        .describe('Use an explicit canonical locationId when the current Trip has multiple selected cities; only one unique selected Trip city may fill an omitted value automatically.') }).strict()).min(1).max(50).optional()
      .describe('Define every new key selected by days[].items[].candidateKey or supportingCandidateKeys. Each entry binds its exact key to supported current-turn sourceRefs; web source receipts alone are not registered candidates. Omitting this list is allowed only when reusing candidates already registered in this same prepared attempt and scope, or when using persisted candidateRef values.'),
    days: z.array(commitGuideInputSchema.shape.days.element.extend({ cityId: z.string().min(1).max(160).optional()
      .describe('Use an explicit canonical cityId when the current Trip has multiple selected cities; only one unique selected Trip city may fill an omitted value automatically.'), items: z.array(item).max(6) })).min(1).max(60)
      .describe('For a first guide or failed first-guide repair, submit the COMPLETE itinerary covering exactly the authoritative Trip duration with consecutive day numbers starting at 1, including rest/travel days within that span. Do not append an optional extra day. For a local edit of an accepted guide, submit only the selected replacement slots; the server preserves other days. Always include both days and text in a corrected submission.'),
    supportingRefs: z.array(candidateReference).max(50).optional()
      .describe('Optional supplemental persisted candidate references, not source URLs. For candidates submitted here, use supportingCandidateKeys instead.'),
    supportingCandidateKeys: commitGuideInputSchema.shape.supportingCandidateKeys
      .describe('Optional keys of supplemental/practical candidates submitted or registered by this prepared attempt; no activity text is required for these.'),
    text: commitGuideInputSchema.shape.text.omit({ activities: true }) }).strict()

export function adaptDshCommit(raw: unknown, preparation: DshPreparation): CommitGuideInput & Record<string, unknown> {
  const data = z.record(z.string(), z.unknown()).parse(raw)
  const { intent, goalRef, ...body } = data
  // Direct domain/fixture callers retain one compatibility boundary.
  const legacy = body.text && typeof body.text === 'object' && 'activities' in body.text
  const compact = legacy ? undefined : dshCommitInputSchema.parse(body)
  const uniqueCity = uniqueSelectedTripCity(preparation.trip)
  if (compact && !uniqueCity) {
    const fieldPaths = [
      ...(compact.candidates ?? []).flatMap((candidate, index) => candidate.locationId === undefined
        ? [`candidates.${index}.locationId`] : []),
      ...compact.days.flatMap((day, index) => day.cityId === undefined ? [`days.${index}.cityId`] : [])
    ].slice(0, 110)
    if (fieldPaths.length) {
      const selected = [...preparation.trip.destinationIntent.required, ...preparation.trip.destinationIntent.preferred]
      const selectedCities = new Set(selected.filter(location => location.type === 'city').map(location => location.id))
      throw new AppError('DSH_GUIDE_NEEDS_REVISION', 'The current Trip has no unique selected city for omitted locations', 422, {
        code: 'candidate_location_unresolved', fieldPaths,
        destinationMode: ['open', 'explicit', 'mixed'].includes(preparation.trip.destinationIntent.mode)
          ? preparation.trip.destinationIntent.mode : 'open',
        selectedCityCount: Math.min(selectedCities.size, 99)
      })
    }
  }
  const expanded = compact ? {
    ...compact,
    ...(compact.candidates ? { candidates: compact.candidates.map(candidate => ({ ...candidate, locationId: candidate.locationId ?? uniqueCity?.id })) } : {}),
    days: compact.days.map(day => ({ ...day, cityId: day.cityId ?? uniqueCity?.id, items: day.items.map(({ text: _text, ...choice }, index) => ({
      ...choice, activityKey: `day-${day.day}-visit-${index + 1}`
    })) })),
    text: { ...compact.text, activities: compact.days.flatMap(day => day.items.map(({ text }, index) => ({
      ...text, activityKey: `day-${day.day}-visit-${index + 1}`
    }))) }
  } : body
  const parsed = commitGuideInputSchema.parse(expanded)
  let resolvedIntent = intent
  if (parsed.replaceSlots || parsed.baseGuideId || parsed.expectedContentHash) {
    const base = preparation.baseGuide
    if (!base) throw new AppError('DSH_GUIDE_BASE_UNAVAILABLE', 'No accepted guide was bound for this edit', 409)
    if (parsed.baseGuideId && parsed.baseGuideId !== base.id || parsed.expectedContentHash && parsed.expectedContentHash !== base.contentHash) {
      throw new AppError('PUBLICATION_CONTENT_CHANGED', 'The submitted edit does not match the prepared guide', 409)
    }
    parsed.baseGuideId = base.id
    parsed.expectedContentHash = base.contentHash
    if (compact && intent !== undefined) {
      const semanticIntent = dshCommitIntentSchema.parse(intent)
      const limits = preparation.editLimits
      if (!limits) throw new AppError('DSH_GUIDE_NEEDS_REVISION', 'The prepared base Goal limits are unavailable', 422, { code: 'guide_edit_limits_unavailable' })
      const { maxResults, maxCities } = semanticIntent.parameters
      if (maxResults !== undefined && maxResults !== limits.maxResults || maxCities !== undefined && maxCities !== limits.maxCities) {
        throw new AppError('DSH_GUIDE_NEEDS_REVISION', 'Explicit edit limits conflict with the prepared base Goal', 422, {
          code: 'guide_edit_limit_conflict', fieldPaths: ['intent.parameters.maxResults', 'intent.parameters.maxCities'],
          repairHint: 'Omit mechanical maxResults/maxCities for this slot edit. The server carries the exact prepared base Goal limits; preserve the explicit semantic intent and all protected findings.'
        })
      }
      resolvedIntent = { kind: 'travel_guide', parameters: travelGuideGoalParametersSchema.parse({ ...semanticIntent.parameters, ...limits }) }
    }
  }
  if (compact && resolvedIntent !== undefined) {
    const semanticIntent = dshCommitIntentSchema.parse(resolvedIntent)
    resolvedIntent = { kind: 'travel_guide', parameters: travelGuideGoalParametersSchema.parse(semanticIntent.parameters) }
  }
  return { ...parsed, ...(resolvedIntent === undefined ? {} : { intent: resolvedIntent }), ...(goalRef === undefined ? {} : { goalRef }) }
}

export function preparedGuideSummary(preparation: DshPreparation, records: readonly ArtifactRecord[]) {
  const record = records.find(value => value.id === preparation.baseGuide?.id)
  const guide = record && travelGuideArtifactPayloadSchema.safeParse(record.payload)
  return guide?.success ? { days: guide.data.days.map(day => ({ day: day.day, city: day.city,
    slots: day.items.map(item => ({ slot: item.timeOfDay ?? 'flexible', title: item.title })) })),
    instruction: 'For a requested local edit, submit replaceSlots and only replacement items. The server binds this exact accepted base and hash.' } : null
}
