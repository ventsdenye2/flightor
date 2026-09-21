import { createHash } from 'node:crypto'
import { z } from 'zod'

export const sourcePageSchema = z.object({
  text: z.string().min(1).max(12_000),
  retrievedAt: z.iso.datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict().refine(page => page.contentHash === createHash('sha256').update(page.text).digest('hex'), 'Page hash mismatch')

const claimFields = z.object({
  kind: z.enum(['price', 'opening_hours', 'transit_duration']),
  subject: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(160),
  quote: z.string().trim().min(1).max(800)
}).strict()
export const draftClaimEvidenceSchema = claimFields.extend({ sourceIndex: z.number().int().min(0).max(49) })
export const claimEvidenceSchema = claimFields.extend({
  sourceUrl: z.url().max(500), retrievedAt: z.iso.datetime(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal('source_observed')
})
export type ClaimEvidence = z.infer<typeof claimEvidenceSchema>
type Source = { url: string; page?: z.infer<typeof sourcePageSchema> | undefined }

/** Provenance/transcription only: neither subject semantics nor future validity is inferred. */
export function supportedClaimEvidence(value: unknown, sources: readonly Source[]): ClaimEvidence | undefined {
  const parsed = claimEvidenceSchema.safeParse(value)
  if (!parsed.success) return
  const claim = parsed.data
  const page = sourcePageSchema.safeParse(sources.find(source => source.url === claim.sourceUrl)?.page)
  if (!page.success || page.data.contentHash !== claim.contentHash || page.data.retrievedAt !== claim.retrievedAt
    || !page.data.text.includes(claim.quote) || !claim.quote.includes(claim.value)) return
  return claim
}

export function admitClaimEvidence(value: unknown, sources: readonly Source[], selected: readonly number[]): ClaimEvidence[] {
  const parsed = z.array(draftClaimEvidenceSchema).max(8).safeParse(value ?? [])
  if (!parsed.success) return []
  return parsed.data.flatMap(({ sourceIndex, ...claim }) => {
    const source = sources[sourceIndex]
    if (!selected.includes(sourceIndex) || !source?.page) return []
    const admitted = supportedClaimEvidence({ ...claim, sourceUrl: source.url, retrievedAt: source.page.retrievedAt,
      contentHash: source.page.contentHash, status: 'source_observed' }, sources)
    return admitted ? [admitted] : []
  })
}

/** A narrow conflict check; differently named/worded claims remain a semantic review task. */
export function hasClaimConflict(claims: readonly ClaimEvidence[]): boolean {
  const values = new Map<string, string>()
  for (const claim of claims) {
    const key = `${claim.kind}:${claim.subject.trim().toLocaleLowerCase('en-US')}`
    const value = claim.value.trim().toLocaleLowerCase('en-US')
    if (values.has(key) && values.get(key) !== value) return true
    values.set(key, value)
  }
  return false
}
