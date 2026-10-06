import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import type { ArtifactRecord, GuideBaseCondition } from '../../artifacts/repository.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import type { TripContext } from '../../trips/types.js'
import type { SelectedFlightContext } from '../../workspaces/flight-selection.js'
import type { PublicationLocale } from '../../travel-guides/finalization-schema.js'
import { commitGuideInputSchema, type CommitGuideInput } from './commit-guide.js'
import { uniqueSelectedTripCity } from './city-preparation.js'

/** Captured before the model runs; never refreshed from a newer draft at commit. */
export interface DshPreparation {
  trip: TripContext
  baseGuide?: GuideBaseCondition
}

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
const item = commitGuideInputSchema.shape.days.element.shape.items.element.omit({ activityKey: true })
  .extend({ text: activity }).strict()
/** DSH-only model contract. The legacy domain and frontend contracts stay intact. */
export const dshCommitInputSchema = commitGuideInputSchema.omit({ baseGuideId: true, expectedContentHash: true, days: true, text: true, candidates: true })
  .extend({ candidates: z.array(z.object({ key: z.string().trim().min(1).max(120), sourceRefs: z.array(z.string().min(1).max(160)).min(1).max(20),
      title: z.string().trim().min(1).max(240), summary: z.string().trim().min(1).max(1500),
      category: z.enum(['event', 'seasonal', 'activity', 'stopover', 'practical']), locationId: z.string().min(1).max(160).optional() }).strict()).min(1).max(50).optional(),
    days: z.array(commitGuideInputSchema.shape.days.element.extend({ cityId: z.string().min(1).max(160).optional(), items: z.array(item).max(6) })).min(1).max(60),
    text: commitGuideInputSchema.shape.text.omit({ activities: true }) }).strict()

export function adaptDshCommit(raw: unknown, preparation: DshPreparation): CommitGuideInput & Record<string, unknown> {
  const data = z.record(z.string(), z.unknown()).parse(raw)
  const { intent, goalRef, ...body } = data
  // Direct domain/fixture callers retain one compatibility boundary.
  const legacy = body.text && typeof body.text === 'object' && 'activities' in body.text
  const compact = legacy ? undefined : dshCommitInputSchema.parse(body)
  const uniqueCity = uniqueSelectedTripCity(preparation.trip)
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
  if (parsed.replaceSlots || parsed.baseGuideId || parsed.expectedContentHash) {
    const base = preparation.baseGuide
    if (!base) throw new AppError('DSH_GUIDE_BASE_UNAVAILABLE', 'No accepted guide was bound for this edit', 409)
    if (parsed.baseGuideId && parsed.baseGuideId !== base.id || parsed.expectedContentHash && parsed.expectedContentHash !== base.contentHash) {
      throw new AppError('PUBLICATION_CONTENT_CHANGED', 'The submitted edit does not match the prepared guide', 409)
    }
    parsed.baseGuideId = base.id
    parsed.expectedContentHash = base.contentHash
  }
  return { ...parsed, ...(intent === undefined ? {} : { intent }), ...(goalRef === undefined ? {} : { goalRef }) }
}

export function preparedGuideSummary(preparation: DshPreparation, records: readonly ArtifactRecord[]) {
  const record = records.find(value => value.id === preparation.baseGuide?.id)
  const guide = record && travelGuideArtifactPayloadSchema.safeParse(record.payload)
  return guide?.success ? { days: guide.data.days.map(day => ({ day: day.day, city: day.city,
    slots: day.items.map(item => ({ slot: item.timeOfDay ?? 'flexible', title: item.title })) })),
    instruction: 'For a requested local edit, submit replaceSlots and only replacement items. The server binds this exact accepted base and hash.' } : null
}
