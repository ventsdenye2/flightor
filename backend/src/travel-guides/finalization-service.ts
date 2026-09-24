import type { ArtifactRecord, ArtifactRepository } from '../artifacts/repository.js'
import { AppError } from '../lib/errors.js'
import { travelGuideArtifactPayloadSchema } from './artifact.js'
import { admittedResearch, publicationFor } from './publication.js'
import { validateIntegratedFinalText, type GuideFinalizer, type FinalizationInput } from './finalization.js'
import { canRetryFinalVariant, type FinalVariant, type PublicationLocale } from './finalization-schema.js'

// Shared across request-scoped service instances; owner is part of the key.
const pending = new Map<string, Promise<ArtifactRecord>>()
interface PublicationApplicationInput {
  ownerId: string; record: ArtifactRecord; artifacts: ArtifactRepository
  locale: PublicationLocale; requirements?: unknown; memoryEnabled?: boolean; localization?: boolean
  retryRevision?: number
  signal?: AbortSignal; timeoutMs?: number; assertCurrent: () => Promise<void>
}

export async function finalizeGuide(input: PublicationApplicationInput & { finalizer: Pick<GuideFinalizer, 'generate'> }): Promise<ArtifactRecord> {
  return applyFinalVariant(input, data => input.finalizer.generate(data))
}

/** DSH first publication: no editor/model call, no caller-supplied accepted status. */
export async function publishIntegratedGuide(input: Omit<PublicationApplicationInput, 'localization' | 'retryRevision' | 'timeoutMs'>
  & { text: unknown }): Promise<ArtifactRecord> {
  return applyFinalVariant(input, data => validateIntegratedFinalText(data, input.text), true)
}

async function applyFinalVariant(input: PublicationApplicationInput,
  generate: (data: FinalizationInput) => FinalVariant | Promise<FinalVariant>, requireDraft = false): Promise<ArtifactRecord> {
  const assertCurrent = async () => {
    input.signal?.throwIfAborted()
    await input.assertCurrent()
    input.signal?.throwIfAborted()
  }
  await assertCurrent()
  const publication = publicationFor(input.record)
  if (!publication?.finalization || !input.artifacts.saveFinalVariant) {
    if (requireDraft) throw new AppError('PUBLICATION_DRAFT_REQUIRED', 'Integrated publication requires a hidden guide draft and publication storage', 409)
    return input.record
  }
  const key = JSON.stringify([input.ownerId, input.record.id, publication.guideContentHash, input.locale, input.retryRevision ?? 0])
  const existing = pending.get(key)
  if (existing) { const record = await existing; await assertCurrent(); return record }
  const task = (async () => {
    const current = await input.artifacts.get(input.record.id)
    if (!current || current.tripId !== input.record.tripId) throw new AppError('RESOURCE_NOT_FOUND', 'Guide was not found', 404)
    const guide = travelGuideArtifactPayloadSchema.parse(current.payload)
    const latest = publicationFor(current)
    if (latest?.guideContentHash !== publication.guideContentHash) throw new AppError('PUBLICATION_CONTENT_CHANGED', 'Guide changed', 409)
    const previous = latest.finalization?.variants[input.locale]
    if (previous?.status === 'accepted') return current
    if (input.retryRevision !== undefined) {
      if (!previous || !canRetryFinalVariant(previous) || input.retryRevision !== (previous.revision ?? 1)) {
        throw new AppError('PUBLICATION_RETRY_UNAVAILABLE', 'Retry requires the current retryable failure revision within the attempt limit', 409)
      }
    } else if (previous) return current
    const accepted = Object.values(latest.finalization!.variants).find(value => value?.status === 'accepted')?.text ?? undefined
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
    await assertCurrent()
    const variant = await generate({ locale: input.locale, guide,
      requirements: input.requirements, research: admittedResearch(records), omitted,
      ...(input.localization && accepted ? { accepted } : {}),
      ...(input.signal ? { signal: input.signal } : {}), ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }) })
    await assertCurrent()
    return input.artifacts.saveFinalVariant!(current.id, publication.guideContentHash, input.locale,
      { ...variant, revision: previous ? (previous.revision ?? 1) + 1 : 1 }, input.signal)
  })()
  pending.set(key, task)
  try { return await task } finally { if (pending.get(key) === task) pending.delete(key) }
}
