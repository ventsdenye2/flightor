import { createHash } from 'node:crypto'
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

type Source = { url: string; snippet: string; page?: { text: string; contentHash: string } | undefined }

type TemporalEvidenceCheck =
  | { ok: true; evidence: TemporalEvidence }
  | { ok: false; reason: 'quote_not_found' | 'date_mismatch' }

function quoteDates(quote: string): string[] | undefined {
  if (/(?:published|publication|updated|last\s+modified|retrieved|valid\s+until|expires?|query\s+window|掲載日|公開日|更新日|取得日|有効期限|検索期間|发布日期|公开日期|发布于|更新日期|最后更新|抓取日期|检索日期|采集日期|有效期|查询窗口|检索窗口)/iu.test(quote)) return
  const isoDates = [...quote.matchAll(/(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)/g)].map(match => match[1]!)
  if (isoDates.length > 0) {
    if (isoDates.length > 2 || /\d{4}\s*(?:年|\/)|\d{1,2}\s*月\s*\d{1,2}\s*日/.test(quote)) return
    return isoDates.every(date => z.iso.date().safeParse(date).success) ? isoDates : undefined
  }

  const weekday = '(?:星期[一二三四五六日天]|[日月火水木金土])'
  const ranges = [...quote.matchAll(new RegExp(`(?<!\\d)(\\d{4})年(\\d{1,2})月(\\d{1,2})日(?:\\s*[（(](?:${weekday})[）)])?\\s*(?:～|〜|~|—|–|-|至|到)\\s*(?:(\\d{4})年)?(\\d{1,2})月(\\d{1,2})日(?:\\s*[（(](?:${weekday})[）)])?`, 'gu'))]
  if (ranges.length !== 1 || /\d{4}-\d{2}-\d{2}/.test(quote)) return
  const match = ranges[0]!
  const remainder = quote.slice(0, match.index) + quote.slice(match.index + match[0].length)
  if (/\d{4}\s*(?:年|\/)|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*日/.test(remainder)) return
  const year = Number(match[1]), endYear = Number(match[4] ?? match[1])
  const start = `${match[1]}-${match[2]!.padStart(2, '0')}-${match[3]!.padStart(2, '0')}`
  const end = `${endYear}-${match[5]!.padStart(2, '0')}-${match[6]!.padStart(2, '0')}`
  return year > 0 && z.iso.date().safeParse(start).success && z.iso.date().safeParse(end).success ? [start, end] : undefined
}

function quoteHasMetadataContext(text: string, quote: string): boolean {
  const clauseBreak = /[。.!?;；\n\r]/u
  const metadataPrefix = /(?:published|publication(?:\s+date)?|updated|last\s+modified|retrieved|valid\s+until|expires?|query\s+window|掲載日|公開日|更新日|取得日|有効期限|検索期間|发布日期|公开日期|发布于|更新日期|最后更新|抓取日期|检索日期|采集日期|有效期|查询窗口|检索窗口)[\s:：,，、|｜-]{0,12}(?:(?:on|from|between|as\s+of|is|was|为|是|于|は|の)[\s:：,，、|｜-]{0,12})?$/iu
  const metadataSuffix = /^[\s:：,，、|｜-]{0,12}(?:published|publication|updated|last\s+modified|retrieved|valid\s+until|expires?|query\s+window|掲載日|公開日|更新日|取得日|有効期限|検索期間|发布日期|公开日期|发布于|更新日期|最后更新|抓取日期|检索日期|采集日期|有效期|查询窗口|检索窗口)/iu
  let offset = 0
  let hasMatch = false
  while ((offset = text.indexOf(quote, offset)) >= 0) {
    hasMatch = true
    let start = offset
    while (start > 0 && !clauseBreak.test(text[start - 1]!)) start--
    let end = offset + quote.length
    while (end < text.length && !clauseBreak.test(text[end]!)) end++
    const prefix = text.slice(Math.max(start, offset - 60), offset)
    const suffix = text.slice(offset + quote.length, Math.min(end, offset + quote.length + 32))
    if (!metadataPrefix.test(prefix) && !metadataSuffix.test(suffix)) return false
    offset += quote.length
  }
  return hasMatch
}

/** Accepts complete ISO dates or one unambiguous CJK occurrence range copied from source text.
 * Snippet quotes are exact; body quotes require the captured page hash. Metadata dates remain invalid.
 * This verifies provenance/date transcription, not the semantic relevance of every source sentence. */
export function supportedTemporalEvidence(value: unknown, sources: readonly Source[]): TemporalEvidence | undefined {
  const result = checkTemporalEvidence(value, sources)
  return result.ok ? result.evidence : undefined
}

export function checkTemporalEvidence(value: unknown, sources: readonly Source[]): TemporalEvidenceCheck {
  const parsed = temporalEvidenceSchema.safeParse(value)
  if (!parsed.success) return { ok: false, reason: 'quote_not_found' }
  const evidence = parsed.data
  for (const source of sources) {
    if (source.url !== evidence.sourceUrl) continue
    const verifiedPage = source.page && source.page.contentHash === createHash('sha256').update(source.page.text).digest('hex')
    if (source.page && !verifiedPage) continue
    const snippetMatch = source.snippet.includes(evidence.quote)
    const pageMatch = Boolean(verifiedPage && source.page!.text.includes(evidence.quote))
    const validSnippetMatch = snippetMatch && !quoteHasMetadataContext(source.snippet, evidence.quote)
    const validPageMatch = pageMatch && !quoteHasMetadataContext(source.page!.text, evidence.quote)
    if (!validSnippetMatch && !validPageMatch) continue
    const dates = quoteDates(evidence.quote)
    if (!dates) return { ok: false, reason: 'quote_not_found' }
    if (dates[0] !== evidence.from || dates[dates.length - 1] !== evidence.to) return { ok: false, reason: 'date_mismatch' }
    return { ok: true, evidence }
  }
  return { ok: false, reason: 'quote_not_found' }
}

export function admitDraftTemporalEvidence(value: unknown, sources: readonly Source[], selectedIndexes: readonly number[]) {
  const parsed = draftTemporalEvidenceSchema.safeParse(value)
  if (!parsed.success || !parsed.data || !selectedIndexes.includes(parsed.data.sourceIndex)) return undefined
  const { sourceIndex, ...evidence } = parsed.data
  const source = sources[sourceIndex]
  return source ? supportedTemporalEvidence({ ...evidence, sourceUrl: source.url }, [source]) : undefined
}
