// src/types/api.ts — 数据接口契约
import type { FlightOption, PricePoint, LayoverOption } from './flight'
import type { PriceSignal } from './common'

/** 搜索请求 */
export interface SearchRequest {
  origin: string
  destination: string
  depart_date: string
  return_date?: string
  currency: 'CNY' | 'USD'
}

/** 搜索响应（组合后） */
export interface SearchResponse {
  direct: FlightOption[]
  selfTransfer: FlightOption[]
  airlineTransfer: FlightOption[]
  metadata: {
    searchId: string
    cacheTime: string
    priceDisclaimer: string
    connectivityVersion?: string
    connectivityEdges?: number
    topologyFiltered?: number
  }
}

/** 价格趋势 */
export interface PriceTrendResponse {
  route: { origin: string; destination: string }
  history: PricePoint[]
  statistics: {
    current: number
    avg30d: number
    min30d: number
    max30d: number
    percentile: number
  }
  signal: PriceSignal
  bestBookingWindow: { daysBeforeDeparture: [number, number] }
}

/** Hub 体验数据 */
export interface HubExperienceResponse {
  hub: string
  city: string
  coverImage: string
  visa: { type: string; duration: string; conditions: string }
  layoverPlans: LayoverOption[]
}

/** 机场自动补全 */
export interface AirportSuggestion {
  iata: string
  name: string
  city: string
  country: string
  lat: number
  lng: number
}
