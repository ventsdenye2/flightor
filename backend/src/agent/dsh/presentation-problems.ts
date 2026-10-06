import { publicProseProblems } from '../../travel-guides/finalization.js'
import type { PublicationLocale } from '../../travel-guides/finalization-schema.js'

export const PRESENTATION_PROBLEM_CODES = [
  'internal_narration', 'budget_guarantee', 'budget_scope_changed', 'excluded_precise_claim', 'excluded_admission_or_hours',
  'unsupported_asset_or_url', 'language', 'duplicated_or_foreign_prose', 'empty_reply'
] as const
export type PresentationProblem = { code: typeof PRESENTATION_PROBLEM_CODES[number]; fieldPath: string }
const codes = new Set<string>(PRESENTATION_PROBLEM_CODES)

function permittedPath(path: string): boolean {
  if (['text', 'text.reply', 'text.overview'].includes(path)) return true
  const theme = /^text\.days\.(0|[1-9]\d?)\.theme$/.exec(path)
  if (theme) return Number(theme[1]) < 60
  const activity = /^days\.(0|[1-9]\d?)\.items\.([0-5])\.text\.(name|introduction|recommendationReason)$/.exec(path)
  return Boolean(activity && Number(activity[1]) < 60)
}

/** Internal feedback contains controlled labels and schema paths, never rejected text. */
export function sanitizePresentationProblems(value: unknown): PresentationProblem[] {
  if (!Array.isArray(value)) return []
  const result: PresentationProblem[] = [], seen = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const { code, fieldPath } = item as Record<string, unknown>
    if (typeof code !== 'string' || !codes.has(code) || typeof fieldPath !== 'string' || !permittedPath(fieldPath)) continue
    const key = `${code}:${fieldPath}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ code: code as PresentationProblem['code'], fieldPath })
    // Every compact text field can be reported for each controlled rule.
    if (result.length === 1143 * PRESENTATION_PROBLEM_CODES.length) break
  }
  return result
}

interface SubmittedText {
  days: readonly { items: readonly { activityKey: string }[] }[]
  text: { reply: string; overview: string; days: readonly { theme: string }[];
    activities: readonly { activityKey: string; name: string; introduction: string; recommendationReason: string }[] }
}

/** Diagnose only rules already rejected by the shared validator; this cannot authorize publication. */
export function submittedPresentationProblems(input: SubmittedText, locale: PublicationLocale,
  budget: { amount: number; currency: string; scope?: string } | null, rejectedCodes: readonly string[],
  options: { includeDayThemes?: boolean } = {}): PresentationProblem[] {
  const rejected = new Set(rejectedCodes.filter(code => codes.has(code)))
  const fields: Array<{ fieldPath: string; value: string }> = [
    { fieldPath: 'text.reply', value: input.text.reply }, { fieldPath: 'text.overview', value: input.text.overview },
    ...(options.includeDayThemes === false ? [] : input.text.days.map((day, index) => ({ fieldPath: `text.days.${index}.theme`, value: day.theme })))
  ]
  const authored = new Map(input.text.activities.map(activity => [activity.activityKey, activity]))
  input.days.forEach((day, dayIndex) => day.items.forEach((item, itemIndex) => {
    const text = authored.get(item.activityKey)
    if (!text) return // An inherited protected activity is not a field in this submission.
    for (const field of ['name', 'introduction', 'recommendationReason'] as const)
      fields.push({ fieldPath: `days.${dayIndex}.items.${itemIndex}.text.${field}`, value: text[field] })
  }))
  const result = fields.flatMap(field => publicProseProblems([field.value], locale, { budget, budgetTarget: true })
    // Language thresholds apply to the full body, never to a short theme or a proper name.
    .filter(code => code !== 'language' && rejected.has(code))
    .map(code => ({ code, fieldPath: field.fieldPath })))
  if (rejected.has('language')) result.push({ code: 'language', fieldPath: 'text' })
  return sanitizePresentationProblems(result)
}
