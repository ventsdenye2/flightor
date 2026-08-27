// src/stores/searchStore.ts — 搜索条件状态
import { makeAutoObservable } from 'mobx'
import type { SearchParams, Interest } from '../types/flight'
import { nearbyAirports } from '../mocks/airports'
import { daysFromNow, toDateString } from '../utils/format'

// 邻近机场候选池半径（公里）；圈内机场默认全选，用户可逐个取消
const CIRCLE_POOL_KM = 300

function extrasOf(iata: string): string[] {
  return nearbyAirports(iata, CIRCLE_POOL_KM)
    .slice(1)
    .map(a => a.iata)
}

export class SearchStore {
  origin = 'SZX'
  destination = 'LHR'
  /** 出发窗口：最早/最晚出发日 */
  departDate = daysFromNow(54)
  departDateEnd = daysFromNow(57)
  tripType: 'oneway' | 'roundtrip' = 'roundtrip'
  /** 往返：游玩天数区间 */
  stayMin = 7
  stayMax = 14
  /** 出发圈：除主机场外勾选的邻近机场 */
  originExtras: string[] = extrasOf('SZX')
  /** 到达圈：除主落地机场外勾选的邻近机场 */
  destExtras: string[] = extrasOf('LHR')
  budgetMin = 2000
  budgetMax = 10000
  transferPref: 'any' | 'direct' | 'transfer' = 'any'
  interests: Interest[] = ['food', 'culture']

  constructor() {
    makeAutoObservable(this)
  }

  setOrigin(iata: string) {
    if (iata === this.origin) return
    this.origin = iata
    this.originExtras = extrasOf(iata)
  }

  setDestination(iata: string) {
    if (iata === this.destination) return
    this.destination = iata
    this.destExtras = extrasOf(iata)
  }

  swapOD() {
    const t = this.origin
    this.origin = this.destination
    this.destination = t
    const e = this.originExtras
    this.originExtras = this.destExtras
    this.destExtras = e
  }

  setDepartDate(date: string) {
    // 不允许选择今天之前的日期（Picker 已限制，此处为跨天会话等场景兜底）
    const today = toDateString(new Date())
    this.departDate = date < today ? today : date
    if (this.departDateEnd < this.departDate) this.departDateEnd = this.departDate
  }

  setDepartDateEnd(date: string) {
    this.departDateEnd = date < this.departDate ? this.departDate : date
  }

  setTripType(type: 'oneway' | 'roundtrip') {
    this.tripType = type
  }

  setStay(min: number, max: number) {
    this.stayMin = Math.max(1, Math.min(min, max))
    this.stayMax = Math.max(this.stayMin, max)
  }

  toggleOriginExtra(iata: string) {
    this.originExtras = this.originExtras.includes(iata)
      ? this.originExtras.filter(x => x !== iata)
      : [...this.originExtras, iata]
  }

  toggleDestExtra(iata: string) {
    this.destExtras = this.destExtras.includes(iata)
      ? this.destExtras.filter(x => x !== iata)
      : [...this.destExtras, iata]
  }

  setBudget(min: number, max: number) {
    this.budgetMin = min
    this.budgetMax = max
  }

  setTransferPref(pref: 'any' | 'direct' | 'transfer') {
    this.transferPref = pref
  }

  toggleInterest(interest: Interest) {
    if (this.interests.includes(interest)) {
      this.interests = this.interests.filter(i => i !== interest)
    } else {
      this.interests = [...this.interests, interest]
    }
  }

  /** 出发圈候选机场（主机场 + 勾选的邻近机场） */
  get originCandidates(): string[] {
    return [this.origin, ...this.originExtras]
  }

  /** 到达圈候选机场（主机场 + 勾选的邻近机场） */
  get destinationCandidates(): string[] {
    return [this.destination, ...this.destExtras]
  }

  get params(): SearchParams {
    return {
      origin: this.origin,
      originCandidates: this.originCandidates,
      destination: this.destination,
      destinationCandidates: this.destinationCandidates,
      departDate: this.departDate,
      departDateEnd: this.departDateEnd,
      stayRange: this.tripType === 'roundtrip' ? [this.stayMin, this.stayMax] : undefined,
      tripType: this.tripType,
      budgetRange: [this.budgetMin, this.budgetMax],
      transferPref: this.transferPref,
      interests: [...this.interests]
    }
  }
}

export const searchStore = new SearchStore()
