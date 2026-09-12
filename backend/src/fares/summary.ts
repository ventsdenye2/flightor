import { z } from 'zod'
import type { FareOffer } from './types.js'

export const fareItinerarySummarySchema = z.object({
  counts: z.object({ direct: z.number().int().nonnegative(), airline: z.number().int().nonnegative(), self: z.number().int().nonnegative() }).strict(),
  lowestByType: z.array(z.object({
    offerId: z.string().min(1).max(240),
    transferType: z.enum(['direct', 'airline', 'self']),
    route: z.array(z.string().regex(/^[A-Z]{3}$/)).min(2).max(24),
    segmentCount: z.number().int().min(1).max(12),
    totalAmount: z.number().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/),
    departsAt: z.string(), arrivesAt: z.string(), totalDurationMinutes: z.number().int().nonnegative().optional()
  }).strict()).max(3)
}).strict()

/** The Planner sees which fare is connecting without fetching the full Artifact. */
export function summarizeFareItineraries(offers: readonly FareOffer[]): z.infer<typeof fareItinerarySummarySchema> {
  const types = ['direct', 'airline', 'self'] as const
  const counts = { direct: 0, airline: 0, self: 0 }
  for (const offer of offers) counts[offer.transferType]++
  const lowestByType = types.flatMap(transferType => {
    const offer = offers.filter(value => value.transferType === transferType).sort((a, b) => a.totalAmount - b.totalAmount)[0]
    if (!offer) return []
    const route: string[] = []
    for (const segment of offer.segments) {
      if (route.at(-1) !== segment.origin) route.push(segment.origin)
      route.push(segment.destination)
    }
    return [{ offerId: offer.id, transferType, route, segmentCount: offer.segments.length,
      totalAmount: offer.totalAmount, currency: offer.currency,
      departsAt: offer.segments[0]!.departsAt, arrivesAt: offer.segments.at(-1)!.arrivesAt,
      totalDurationMinutes: offer.totalDurationMinutes }]
  })
  return { counts, lowestByType }
}
