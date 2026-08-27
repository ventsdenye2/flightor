// src/utils/format.ts — 格式化（时间/价格/时长）

/** 分钟 → "13h 30min" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h ${m}min`
}

/** 分钟 → "13小时30分" */
export function formatDurationCN(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}分钟`
  if (m === 0) return `${h}小时`
  return `${h}小时${m}分`
}

/** 价格 → "¥3,200" */
export function formatPrice(price: number, symbol = '¥'): string {
  return `${symbol}${Math.round(price).toLocaleString('en-US')}`
}

/** ISO 时间 → "22:00" */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/** ISO 时间 → "09-15" */
export function formatMonthDay(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 跨天标记：出发/到达差几天 → "" | "(+1)" | "(+2)" */
export function crossDayMark(departIso: string, arriveIso: string): string {
  const dep = new Date(departIso)
  const arr = new Date(arriveIso)
  const d0 = new Date(dep.getFullYear(), dep.getMonth(), dep.getDate()).getTime()
  const d1 = new Date(arr.getFullYear(), arr.getMonth(), arr.getDate()).getTime()
  const diff = Math.round((d1 - d0) / 86400000)
  return diff > 0 ? `(+${diff})` : ''
}

/** Date → "2026-09-15" */
export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** N 天后日期字符串 */
export function daysFromNow(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return toDateString(d)
}

const WEEK_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEK_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** ISO 日期 → 「10月11日 周日」 / 「Oct 11, Sun」 */
export function humanDate(iso: string, locale: 'zh' | 'en'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return locale === 'zh'
    ? `${d.getMonth() + 1}月${d.getDate()}日 ${WEEK_ZH[d.getDay()]}`
    : `${MONTH_EN[d.getMonth()]} ${d.getDate()}, ${WEEK_EN[d.getDay()]}`
}
