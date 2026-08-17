// src/stores/searchStore.ts — 搜索条件状态
import { makeAutoObservable } from 'mobx'
import type { SearchParams, Interest } from '../types/flight'
import { nearbyAirports } from '../mocks/airports'
import { daysFromNow } from '../utils/format'

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
  /** 出发圈半径（公里，0=仅本场） */
  circleRadiusKm = 200
  /** 到达圈半径（公里，0=仅本场） */
  destCircleRadiusKm = 200
  budgetMin = 2000
  budgetMax = 10000
  transferPref: 'any' | 'direct' | 'transfer' = 'any'
  interests: Interest[] = ['food', 'culture']

  constructor() {
    makeAutoObservable(this)
  }

  setOrigin(iata: string) {
    this.origin = iata
  }

  setDestination(iata: string) {
    this.destination = iata
  }

  swapOD() {
    const t = this.origin
    this.origin = this.destination
    this.destination = t
  }

  setDepartDate(date: string) {
    this.departDate = date
    if (this.departDateEnd < date) this.departDateEnd = date
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

  setCircleRadius(km: number) {
    this.circleRadiusKm = km
  }

  setDestCircleRadius(km: number) {
    this.destCircleRadiusKm = km
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

  /** 出发圈候选机场（含主机场，按距离升序，最多 3 个） */
  get originCandidates(): string[] {
    return nearbyAirports(this.origin, this.circleRadiusKm).map(a => a.iata)
  }

  /** 到达圈候选机场（含主机场） */
  get destinationCandidates(): string[] {
    return nearbyAirports(this.destination, this.destCircleRadiusKm).map(a => a.iata)
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
