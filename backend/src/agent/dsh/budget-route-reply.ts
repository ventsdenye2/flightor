import type { ArtifactRecord } from '../../artifacts/repository.js'
import { routeSetPayloadSchema, type CompleteFlightPath } from '../../flight-routing/types.js'
import { joinsSeparateOffers, pathHasSelfTransfer } from '../../flight-routing/itinerary.js'
import type { PublicationLocale } from '../../travel-guides/finalization-schema.js'

/** Only a fully bound immutable fare across every edge is comparable. */
function comparableFare(path: CompleteFlightPath): NonNullable<CompleteFlightPath['totalFare']> | undefined {
  const total = path.totalFare
  if (!total || !path.edges.length) return undefined
  if (path.edges.some(edge => !edge.fare || !edge.fareArtifactId || !edge.fareOfferId || edge.fare.currency !== total.currency)) return undefined
  const sum = path.edges.reduce((amount, edge) => amount + edge.fare!.amount, 0)
  return Math.abs(sum - total.amount) <= 0.01 ? total : undefined
}

function checkedDate(path: CompleteFlightPath): string | undefined {
  const dates = path.edges.map(edge => edge.verification.checkedAt).filter(value => Number.isFinite(Date.parse(value)))
  if (dates.length !== path.edges.length) return undefined
  return dates.sort()[0]?.slice(0, 10)
}

/** A bounded, server-authored public explanation. It never includes model prose or route warning text. */
export function budgetRouteReply(record: ArtifactRecord, locale: PublicationLocale): string | undefined {
  if (record.type !== 'route_set' || record.schemaVersion !== 1) return undefined
  const parsed = routeSetPayloadSchema.safeParse(record.payload)
  if (!parsed.success || parsed.data.kind !== 'optimized_routes') return undefined
  const cheapest = parsed.data.representatives.find(value => value.badges.includes('cheapest'))
  const path = cheapest?.path
  const fare = path ? comparableFare(path) : undefined
  const date = path ? checkedDate(path) : undefined
  const independent = Boolean(path?.edges.some((edge, index) => index > 0 && joinsSeparateOffers(path.edges[index - 1]!, edge)))
  const selfTransfer = Boolean(path && pathHasSelfTransfer(path.edges))
  const baggageUnknown = Boolean(path?.edges.some(edge => edge.baggageRecheck === undefined))
  const protectionUnknown = Boolean(path?.edges.some(edge => edge.protectedConnection === undefined))
  if (locale === 'en') {
    const price = fare ? `The lowest comparable fare found in this search scope is ${fare.currency} ${fare.amount.toFixed(2)}.`
      : 'No comparable fare was obtained in this search scope.'
    const checked = date ? ` Fare quotes were retrieved on ${date}.` : ''
    const caveats = [independent ? 'This route combines independently quoted offers and requires separate tickets.' : '',
      selfTransfer ? 'It includes self-transfer.' : '', baggageUnknown ? 'Baggage handling needs confirmation.' : '',
      protectionUnknown ? 'Connection protection needs confirmation.' : ''].filter(Boolean).join(' ')
    return `${price}${checked} This is limited to the routes searched here, not a market-wide lowest fare.${caveats ? ` ${caveats}` : ''} Review the route details and explicitly select a flight before planning around it.`
  }
  const price = fare ? `本次搜索范围内可比报价的最低价为 ${fare.currency} ${fare.amount.toFixed(2)}。`
    : '本次搜索范围内未获得可比票价。'
  const checked = date ? `票价查询日期为 ${date}。` : ''
  const caveats = [independent ? '此路线组合了独立报价，需分别出票。' : '',
    selfTransfer ? '包含自行中转。' : '', baggageUnknown ? '行李处理方式待确认。' : '',
    protectionUnknown ? '衔接保障待确认。' : ''].filter(Boolean).join('')
  return `${price}${checked}这仅是本次已搜索路线的比较结果，并非全网最低价。${caveats}请查看路线详情，并明确采用航班后再据此规划。`
}
