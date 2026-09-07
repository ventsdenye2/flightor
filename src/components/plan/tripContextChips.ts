import type { CloudLocationRef, CloudTripContextSummary, CloudDateWindow } from '../../services/conversationService'

export type TripContextChipKind =
  | 'origin'
  | 'dates'
  | 'travel-days'
  | 'budget'
  | 'destination-required'
  | 'destination-preferred'
  | 'destination-excluded'
  | 'interest'

export interface TripContextChipViewModel {
  /** Stable for the same field and source-array position; suitable for a list key. */
  id: string
  kind: TripContextChipKind
  label: string
  /** Accessible label for the remove control. */
  removeLabel: string
}

export type TripContextLocale = 'zh' | 'en'

/** Display bounds keep the row compact even if a valid server summary is unusually full. */
export const MAX_DESTINATION_CHIPS = 6
export const MAX_INTEREST_CHIPS = 6

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const INTEREST_LABELS: Record<string, { zh: string; en: string }> = {
  culture: { zh: '文化', en: 'Culture' },
  food: { zh: '美食', en: 'Food' },
  nature: { zh: '自然', en: 'Nature' },
  shopping: { zh: '购物', en: 'Shopping' },
  nightlife: { zh: '夜生活', en: 'Nightlife' }
}

const DESTINATION_PREFIXES: Record<'required' | 'preferred' | 'excluded', { zh: string; en: string }> = {
  required: { zh: '必去', en: 'Must visit' },
  preferred: { zh: '偏好', en: 'Prefer' },
  excluded: { zh: '避开', en: 'Avoid' }
}

const BUDGET_SCOPE_LABELS: Record<'airfare' | 'transport' | 'trip', { zh: string; en: string }> = {
  airfare: { zh: '机票预算', en: 'Airfare budget' },
  transport: { zh: '交通预算', en: 'Transport budget' },
  trip: { zh: '行程预算', en: 'Trip budget' }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function formatLocation(location: CloudLocationRef): string | null {
  if (!nonEmpty(location.name)) return null
  const name = location.name.trim()
  const iata = nonEmpty(location.iata) ? location.iata.trim() : ''
  return iata ? `${name} (${iata})` : name
}

/** Parse a date-only value without applying the device timezone. */
function dateParts(value: unknown): [number, number, number] | null {
  if (!nonEmpty(value)) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null
  return [year, month, day]
}

function formatDate(value: unknown, precision: CloudDateWindow['precision'], locale: TripContextLocale): string | null {
  const parts = dateParts(value)
  if (!parts) return null
  const [, month, day] = parts
  const date = locale === 'zh' ? `${month}月${day}日` : `${MONTHS_EN[month - 1]} ${day}`
  return precision === 'approximate' ? (locale === 'zh' ? `约${date}` : `~${date}`) : date
}

function formatDateWindow(window: CloudDateWindow | undefined, locale: TripContextLocale): string | null {
  if (!window) return null
  const from = formatDate(window.from, window.precision, locale)
  const to = formatDate(window.to, window.precision, locale)
  if (!from && !to) return null
  if (!from || !to || from === to) return from ?? to
  return `${from}–${to}`
}

function formatDates(summary: CloudTripContextSummary, locale: TripContextLocale): string | null {
  const departure = formatDateWindow(summary.departureWindow, locale)
  const returning = formatDateWindow(summary.returnWindow, locale)
  if (!departure && !returning) return null
  if (!departure || !returning) return departure ?? returning
  return locale === 'zh' ? `去 ${departure} · 回 ${returning}` : `Depart ${departure} · return ${returning}`
}

function formatBudgetAmount(amount: number, currency: string, locale: TripContextLocale): string | null {
  if (!Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency)) return null
  const fractionDigits = Number.isInteger(amount) ? 0 : 2
  try {
    return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(amount)
  } catch {
    // Keep the server-supplied currency code and amount when a platform lacks it.
    return `${currency} ${amount.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    })}`
  }
}

function chip(
  id: string,
  kind: TripContextChipKind,
  label: string,
  locale: TripContextLocale
): TripContextChipViewModel {
  return {
    id,
    kind,
    label,
    removeLabel: locale === 'zh' ? `移除${label}` : `Remove ${label}`
  }
}

function addDestinationChips(
  chips: TripContextChipViewModel[],
  summary: CloudTripContextSummary,
  locale: TripContextLocale
) {
  const groups: Array<['required' | 'preferred' | 'excluded', CloudLocationRef[]]> = [
    ['required', summary.destinations.required],
    ['preferred', summary.destinations.preferred],
    ['excluded', summary.destinations.excluded]
  ]
  let added = 0
  for (const [kind, locations] of groups) {
    for (let index = 0; index < locations.length && added < MAX_DESTINATION_CHIPS; index += 1) {
      const value = formatLocation(locations[index])
      if (!value) continue
      const prefix = DESTINATION_PREFIXES[kind][locale]
      chips.push(chip(`destination-${kind}-${index}`, `destination-${kind}`, `${prefix} · ${value}`, locale))
      added += 1
    }
  }
}

/**
 * Convert the server-owned compact summary into display-only chips.
 * No fallback airport, date, budget, or destination is generated here.
 */
export function formatTripContextChips(
  summary: CloudTripContextSummary | null | undefined,
  locale: TripContextLocale
): TripContextChipViewModel[] {
  if (!summary) return []
  const chips: TripContextChipViewModel[] = []

  if (summary.origin) {
    const value = formatLocation(summary.origin)
    if (value) chips.push(chip('origin', 'origin', locale === 'zh' ? `出发 · ${value}` : `From · ${value}`, locale))
  }

  const dates = formatDates(summary, locale)
  if (dates) chips.push(chip('dates', 'dates', locale === 'zh' ? `日期 · ${dates}` : `Dates · ${dates}`, locale))

  const travelDays = summary.travelDays
  if (typeof travelDays === 'number' && Number.isInteger(travelDays) && travelDays > 0) {
    const value = locale === 'zh' ? `${travelDays}天` : `${travelDays} days`
    chips.push(chip('travel-days', 'travel-days', locale === 'zh' ? `时长 · ${value}` : `Stay · ${value}`, locale))
  }

  if (summary.budget) {
    const amount = formatBudgetAmount(summary.budget.amount, summary.budget.currency, locale)
    if (amount) {
      const scope = BUDGET_SCOPE_LABELS[summary.budget.scope][locale]
      chips.push(chip('budget', 'budget', `${scope} · ${amount}`, locale))
    }
  }

  addDestinationChips(chips, summary, locale)

  const interests = Array.isArray(summary.interests) ? summary.interests : []
  for (let index = 0; index < interests.length && index < MAX_INTEREST_CHIPS; index += 1) {
    const raw = interests[index]
    if (!nonEmpty(raw)) continue
    const value = INTEREST_LABELS[raw.trim()]?.[locale] ?? raw.trim()
    chips.push(chip(`interest-${index}`, 'interest', locale === 'zh' ? `兴趣 · ${value}` : `Interest · ${value}`, locale))
  }

  return chips
}
