import { z } from 'zod'

/** A date claim is not evidence until it is anchored in a retrieved source excerpt. */
const temporalEvidenceFields = z.object({
  from: z.iso.date(), to: z.iso.date(), sourceUrl: z.url().max(500),
  quote: z.string().trim().min(1).max(800)
}).strict()
export const temporalEvidenceSchema = temporalEvidenceFields.refine(value => value.from <= value.to, 'Date range must be ordered')
export type TemporalEvidence = z.infer<typeof temporalEvidenceSchema>

export const draftTemporalEvidenceSchema = temporalEvidenceFields.omit({ sourceUrl: true }).extend({
  sourceIndex: z.number().int().nonnegative()
}).refine(value => value.from <= value.to, 'Date range must be ordered').nullable().optional()

type Source = { url: string; snippet: string }

/** Conservative initial format: explicit full ISO dates in source order, never query/expiry dates.
 * Other source date formats remain unknown instead of being inferred from model prose.
 * This verifies provenance/date transcription, not the semantic relevance of every source sentence. */
export function supportedTemporalEvidence(value: unknown, sources: readonly Source[]): TemporalEvidence | undefined {
  const parsed = temporalEvidenceSchema.safeParse(value)
  if (!parsed.success) return undefined
  const evidence = parsed.data
  const source = sources.find(source => source.url === evidence.sourceUrl)
  if (!source || !source.snippet.includes(evidence.quote)) return undefined
  const dates = [...new Set(evidence.quote.match(/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/g) ?? [])]
  if (dates.length < 1 || dates.length > 2 || dates.some(date => !z.iso.date().safeParse(date).success)) return undefined
  if (dates[0] !== evidence.from || dates[dates.length - 1] !== evidence.to) return undefined
  return evidence
}

export function admitDraftTemporalEvidence(value: unknown, sources: readonly Source[], selectedIndexes: readonly number[]) {
  const parsed = draftTemporalEvidenceSchema.safeParse(value)
  if (!parsed.success || !parsed.data || !selectedIndexes.includes(parsed.data.sourceIndex)) return undefined
  const { sourceIndex, ...evidence } = parsed.data
  const source = sources[sourceIndex]
  return source ? supportedTemporalEvidence({ ...evidence, sourceUrl: source.url }, sources) : undefined
}
