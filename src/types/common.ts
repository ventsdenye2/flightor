// src/types/common.ts — 通用类型

/** 兴趣标签（影响中转玩法推荐） */
export type Interest = 'food' | 'culture' | 'nature' | 'shopping' | 'nightlife'

/** 风险等级 */
export type Severity = 'info' | 'warning' | 'danger'

/** 中转方式 */
export type TransferType = 'self' | 'airline' | 'direct'

/** 买入信号 */
export type PriceSignal = 'buy' | 'wait' | 'neutral'

/** 签证状态 */
export type VisaStatus = 'free' | 'conditional' | 'required'

/** 机场基础点位 */
export interface AirportPoint {
  iata: string
  name: string
  latitude: number
  longitude: number
}

/** Hub 点位（用于地图） */
export interface HubPoint extends AirportPoint {
  savingsPercent: number
  isRecommended: boolean
}

/** 风险条目 */
export interface RiskItem {
  icon: string
  title: string
  description: string
  severity: Severity
}
