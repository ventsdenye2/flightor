const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  两: 2,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

const CHINESE_SMALL_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1_000
}

function parseChineseInteger(value: string): number | null {
  const normalized = value.trim()
  if (!normalized) return null
  if (/^\d+$/.test(normalized)) return Number(normalized)
  if (!/^[零〇一二两三四五六七八九十百千]+$/.test(normalized)) return null

  let section = 0
  let number = 0
  for (const character of normalized) {
    const digit = CHINESE_DIGITS[character]
    if (digit !== undefined) {
      number = digit
      continue
    }
    const unit = CHINESE_SMALL_UNITS[character]
    if (unit === undefined) return null
    section += (number || 1) * unit
    number = 0
  }
  return section + number
}

function parseWanSuffix(value: string): number | null {
  const suffix = value.trim()
  if (!suffix) return 0
  if (/^[零〇]+$/.test(suffix)) return null
  if (/^[一二两三四五六七八九]$/.test(suffix)) return parseChineseInteger(suffix)! * 1_000
  return parseChineseInteger(suffix)
}

function hasAmbiguousContinuation(text: string, match: RegExpMatchArray): boolean {
  const end = (match.index ?? 0) + match[0].length
  return /^\s*(?:多|余|左右|上下|以上|以下|起步|起|到|至|[-~～])/.test(text.slice(end))
}

/** Keep Mock budget semantics aligned with backend rules without dependencies. */
export function parseBudget(text: string): number | null {
  const label = '(?:(?:预算|budget)(?:\\s*(?:上限|最多|不超过|为|是|改成|改为|换成|调整为|变成|设为|设置为))?\\s*)?'
  const unitSuffix = '(?:元|块|人民币|rmb|cny)?'
  const chineseWan = text.match(new RegExp(`${label}([零〇一二两三四五六七八九十百千]+)\\s*万\\s*([零〇一二两三四五六七八九十百千]+)?\\s*${unitSuffix}`, 'i'))
  if (chineseWan) {
    if (hasAmbiguousContinuation(text, chineseWan)) return null
    const whole = parseChineseInteger(chineseWan[1]!)
    const suffix = parseWanSuffix(chineseWan[2] ?? '')
    if (whole !== null && suffix !== null) return whole * 10_000 + suffix
  }

  const arabicWan = text.match(new RegExp(`${label}(\\d+(?:\\.\\d+)?)\\s*[万w]\\s*(?:(\\d+(?:\\.\\d+)?)\\s*(千|k)?)?\\s*${unitSuffix}`, 'i'))
  if (arabicWan) {
    const afterWan = text.slice((arabicWan.index ?? 0) + arabicWan[0].length)
    if (/万\s*零|w\s*零/i.test(arabicWan[0]) || /^\s*零/.test(afterWan) || hasAmbiguousContinuation(text, arabicWan)) return null
    const whole = Number(arabicWan[1])
    if (!Number.isFinite(whole)) return null
    const suffix = arabicWan[2] === undefined ? 0 : Number(arabicWan[2]) * 1_000
    if (!Number.isFinite(suffix)) return null
    return Math.round(whole * 10_000 + suffix)
  }

  const chineseQian = text.match(new RegExp(`${label}([零〇一二两三四五六七八九十百千]+)\\s*千\\s*${unitSuffix}`, 'i'))
  if (chineseQian) {
    if (hasAmbiguousContinuation(text, chineseQian)) return null
    const value = parseChineseInteger(chineseQian[1]!)
    if (value !== null) return value * 1_000
  }

  const arabicQian = text.match(new RegExp(`${label}(\\d+(?:\\.\\d+)?)\\s*[千k]\\s*${unitSuffix}`, 'i'))
  if (arabicQian) {
    if (hasAmbiguousContinuation(text, arabicQian)) return null
    const value = Number(arabicQian[1])
    if (Number.isFinite(value)) return Math.round(value * 1_000)
  }

  const plain = text.match(/(?:预算|budget)\s*(?:上限|最多|不超过|为|是|改成|改为|换成|调整为|变成|设为|设置为)?\s*(\d{3,8})(?:\s*(?:元|块|rmb|cny))?/i)
  if (plain && hasAmbiguousContinuation(text, plain)) return null
  return plain ? Number(plain[1]) : null
}
