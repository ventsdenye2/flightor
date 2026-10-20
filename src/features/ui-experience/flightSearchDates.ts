export function localFlightToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function shiftFlightMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number)
  return localFlightToday(new Date(year, number - 1 + offset, 1)).slice(0, 7)
}
export function flightMonthDays(month: string): string[] {
  const [year, number] = month.split('-').map(Number)
  const leading = new Date(year, number - 1, 1).getDay()
  const count = new Date(year, number, 0).getDate()
  return [...Array(leading).fill(''), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
}
export function selectFlightDate(date: string, departure: string, returning: string, target: 'departure' | 'return', roundTrip: boolean) {
  if (target === 'departure' || !departure || date < departure) return {
    departure: date, returning: target === 'departure' && returning >= date ? returning : '', target: roundTrip ? 'return' as const : 'departure' as const
  }
  return { departure, returning: date, target: 'return' as const }
}
