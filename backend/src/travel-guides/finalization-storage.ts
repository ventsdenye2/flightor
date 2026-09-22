import type { ArtifactRecord } from '../artifacts/repository.js'
import { AppError } from '../lib/errors.js'
import { travelGuideArtifactPayloadSchema } from './artifact.js'
import { publicationFor } from './publication.js'
import { finalVariantSchema, type FinalVariant, type PublicationLocale } from './finalization-schema.js'
import { textProblems } from './finalization.js'

/** Publication-only merge: no model is allowed to update domain content. */
export function mergeFinalVariant(record: ArtifactRecord, hash: string, locale: PublicationLocale, value: FinalVariant) {
  const guide = travelGuideArtifactPayloadSchema.parse(record.payload)
  const publication = publicationFor(record)
  if (!publication || publication.legacy || publication.guideContentHash !== hash || !publication.finalization) {
    throw new AppError('PUBLICATION_CONTENT_CHANGED', 'Guide content changed', 409)
  }
  const variant = finalVariantSchema.parse(value)
  if (variant.status === 'accepted' && (!variant.text || variant.issues.length
    || textProblems(variant.text, { locale, guide, requirements: null, research: [] }).length)) {
    throw new AppError('PUBLICATION_INVALID_TEXT', 'Invalid publication text or identity', 422)
  }
  if (variant.text && variant.text.locale !== locale) throw new AppError('PUBLICATION_LOCALE_MISMATCH', 'Locale mismatch', 409)
  const existing = publication.finalization.variants[locale]
  return { ...guide, publication: { ...publication, finalization: { version: 1 as const,
    variants: { ...publication.finalization.variants, [locale]: existing ?? variant } } } }
}
