import type { ArtifactRecord, ArtifactRepository } from '../artifacts/repository.js'
import { AppError } from '../lib/errors.js'
import { travelGuideArtifactPayloadSchema } from './artifact.js'
import { admittedResearch, publicationFor } from './publication.js'
import { GuideFinalizer } from './finalization.js'
import type { PublicationLocale } from './finalization-schema.js'

// Shared across request-scoped service instances; owner is part of the key.
const pending = new Map<string, Promise<ArtifactRecord>>()
export async function finalizeGuide(input: {
  ownerId: string; record: ArtifactRecord; artifacts: ArtifactRepository; finalizer: GuideFinalizer
  locale: PublicationLocale; requirements?: unknown; memoryEnabled?: boolean; localization?: boolean
  signal?: AbortSignal; timeoutMs?: number; assertCurrent: () => Promise<void>
}): Promise<ArtifactRecord> {
  await input.assertCurrent()
  const publication = publicationFor(input.record)
  if (!publication?.finalization || !input.artifacts.saveFinalVariant) return input.record
  if (publication.finalization.variants[input.locale]) return input.record
  const key = JSON.stringify([input.ownerId, input.record.id, publication.guideContentHash, input.locale])
  const existing = pending.get(key)
  if (existing) { const record = await existing; await input.assertCurrent(); return record }
  const task = (async () => {
    const current = await input.artifacts.get(input.record.id)
    if (!current || current.tripId !== input.record.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Guide was not found', 404)
    const guide = travelGuideArtifactPayloadSchema.parse(current.payload)
    const latest = publicationFor(current)
    if (latest?.finalization?.variants[input.locale]) return current
    if (latest?.guideContentHash !== publication.guideContentHash) throw new AppError('PUBLICATION_CONTENT_CHANGED', 'Guide changed', 409)
    const accepted = Object.values(publication.finalization!.variants).find(value => value?.status === 'accepted')?.text ?? undefined
    if (input.localization && !accepted) return current
    const records: ArtifactRecord[] = []
    const omitted: string[] = []
    if (!input.localization) {
      const ids = new Set(guide.sourceArtifactIds)
      for (const id of ids) {
        const record = await input.artifacts.getForScope(id, { tripId: current.tripId })
        if (record?.type === 'research') records.push(record)
      }
      // Include contradictory compatible records, not just the plan's citations.
      const related = await input.artifacts.listForTrip?.(current.tripId, 100) ?? []
      if (related.length >= 100) omitted.push('Trip artifact listing reached 100 records; potentially relevant research was omitted.')
      for (const record of related) {
        if (record.type !== 'research' || record.tripContextVersion !== current.tripContextVersion || ids.has(record.id)) continue
        if (!input.memoryEnabled && record.conversationId !== current.conversationId) continue
        ids.add(record.id); records.push(record)
      }
    }
    await input.assertCurrent()
    const variant = await input.finalizer.generate({ locale: input.locale, guide,
      requirements: input.requirements, research: admittedResearch(records), omitted,
      ...(input.localization && accepted ? { accepted } : {}),
      ...(input.signal ? { signal: input.signal } : {}), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) })
    await input.assertCurrent()
    return input.artifacts.saveFinalVariant!(current.id, publication.guideContentHash, input.locale, variant, input.signal)
  })()
  pending.set(key, task)
  try { return await task } finally { if (pending.get(key) === task) pending.delete(key) }
}
