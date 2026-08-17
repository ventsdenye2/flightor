// src/types/flight.ts — 航班领域模型
import type { Interest, TransferType, VisaStatus } from './common'

/** 搜索参数（SearchPanel 收集） */
export interface SearchParams {
  origin: string        // 主机场 IATA e.g. "SZX"
  originCandidates: string[] // 出发圈候选机场（含主机场，邻近机场一起比价）
  destination: string   // 主落地机场 IATA e.g. "LHR"
  destinationCandidates: string[] // 到达圈候选机场（含主机场）
  departDate: string    // 最早出发日 ISO 8601
  departDateEnd: string // 最晚出发日（与 departDate 构成出发窗口）
  returnDate?: string   // 往返时填写（保留字段，改用 stayRange 时可空）
  stayRange?: [number, number] // 往返：游玩天数区间 [min, max]
  tripType: 'oneway' | 'roundtrip'
  budgetRange: [number, number] // [min, max] 人民币
  transferPref: 'any' | 'direct' | 'transfer'
  interests: Interest[]  // 影响中转玩法推荐
}

/** 航段 */
export interface FlightSegment {
  flightNo: string           // e.g. "TR101"
  airline: string
  origin: string
  destination: string
  departTime: string
  arriveTime: string
  duration: number           // 分钟
  aircraft?: string
}

/** Hub 信息（挂在航班方案上） */
export interface HubInfo {
  iata: string
  city: string
  layoverMinutes: number
  visaStatus: VisaStatus
  visaNote: string
  baggageRecheck: boolean   // 行李是否需自取重挂
}

/** 单条航班方案 */
export interface FlightOption {
  id: string
  segments: FlightSegment[]
  totalPrice: number
  totalDuration: number      // 分钟
  airline: string
  transferType: TransferType
  hub?: HubInfo
}

/** 中转模式对比项（9 维度） */
export interface TransferOption {
  mode: 'self' | 'airline'
  price: number
  baggagePolicy: string
  missedConnectionRisk: 'low' | 'medium' | 'high'
  visaRequired: boolean
  visaDetail?: string
  stopoverPlayable: boolean
  minConnectionTime: number  // 分钟
  totalDuration: number      // 分钟
  protectionLevel: string
  flexibility: string
}

/** 行程单分段（登机牌行程） */
export interface ItinerarySegment {
  type: 'flight' | 'layover'
  flightNo?: string
  airline?: string
  origin?: string
  destination?: string
  departTime?: string
  arriveTime?: string
  terminal?: string
  gate?: string
  duration?: number
  visaStatus?: string
  playTip?: string
}

/** Hub 停留活动 */
export interface Activity {
  icon: string
  title: string
  description: string
  source: 'xiaohongshu' | 'reddit' | 'backpackers' | 'official'
}

/** 停留时长方案 */
export interface LayoverOption {
  duration: '8h' | '12h' | '24h' | '48h'
  activities: Activity[]
  budget: { currency: string; min: number; max: number }
}

/** Hub 停留体验 */
export interface HubExperience {
  city: string
  iata: string
  coverImage: string
  visaStatus: VisaStatus
  layoverOptions: LayoverOption[]
  transitVisa: string
  transportFromAirport: string
}

/** 价格点 */
export interface PricePoint {
  date: string
  price: number
  isLowest?: boolean
}

export type { Interest, TransferType }
