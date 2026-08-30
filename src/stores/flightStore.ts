// src/stores/flightStore.ts — 搜索结果与选中方案状态
import { makeAutoObservable, runInAction } from 'mobx'
import type { FlightOption, SearchParams } from '../types/flight'
import type { SearchResponse } from '../types/api'
import { searchFlights, buildPriceMatrix, PriceMatrixData } from '../services/flightService'
import { USE_MOCK } from '../utils/request'
import { isExcludedByCountry, sortByRecommendation } from '../utils/flightRecommendation'

export class FlightStore {
  isLoading = false
  error = ''
  result: SearchResponse | null = null
  lastParams: SearchParams | null = null
  /** 结果页视图模式：全部 / 仅自行中转 / 仅联程直飞 */
  viewMode: 'all' | 'self' | 'official' = 'all'
  /** 排序：综合推荐 / 价格优先 / 时长优先 */
  sortBy: 'recommended' | 'price' | 'duration' = 'recommended'
  /** 价差矩阵（机场×日期） */
  matrix: PriceMatrixData | null = null
  /** 矩阵点选的聚焦组合（null=全部组合） */
  matrixPick: { origin: string; date: string } | null = null
  /** 矩阵点选前的原始搜索条件（用于恢复） */
  private originalParams: SearchParams | null = null
  /** 当前选中方案（进入详情页） */
  selected: FlightOption | null = null

  constructor() {
    makeAutoObservable(this)
  }

  async search(params: SearchParams) {
    this.isLoading = true
    this.error = ''
    this.lastParams = params
    this.originalParams = params
    this.matrixPick = null
    try {
      const res = await searchFlights(params)
      runInAction(() => {
        this.result = res
        // 矩阵仅在多组合时有意义；真实 API 接入后由云函数返回
        this.matrix = USE_MOCK ? buildPriceMatrix(params) : null
        this.isLoading = false
      })
    } catch (e) {
      runInAction(() => {
        this.error = (e as Error)?.message || '搜索失败'
        this.isLoading = false
      })
    }
  }

  /** 点选矩阵格子：聚焦到单（机场,日期）组合；再次点击同一格恢复全部 */
  async pickMatrixCell(origin: string, date: string) {
    const base = this.originalParams
    if (!base) return
    if (this.matrixPick && this.matrixPick.origin === origin && this.matrixPick.date === date) {
      return this.clearMatrixPick()
    }
    this.matrixPick = { origin, date }
    this.isLoading = true
    const narrowed: SearchParams = {
      ...base,
      origin,
      originCandidates: [origin],
      departDate: date,
      departDateEnd: date
    }
    try {
      const res = await searchFlights(narrowed)
      runInAction(() => {
        this.result = res
        this.lastParams = narrowed
        this.isLoading = false
      })
    } catch (e) {
      runInAction(() => {
        this.error = (e as Error)?.message || '搜索失败'
        this.isLoading = false
      })
    }
  }

  /** 恢复全部组合（重新按原始窗口搜索，矩阵确定性不变） */
  async clearMatrixPick() {
    const base = this.originalParams
    if (!base) return
    this.matrixPick = null
    this.isLoading = true
    try {
      const res = await searchFlights(base)
      runInAction(() => {
        this.result = res
        this.lastParams = base
        this.isLoading = false
      })
    } catch (e) {
      runInAction(() => {
        this.error = (e as Error)?.message || '搜索失败'
        this.isLoading = false
      })
    }
  }

  setViewMode(mode: 'all' | 'self' | 'official') {
    this.viewMode = mode
  }

  setSortBy(sort: 'recommended' | 'price' | 'duration') {
    this.sortBy = sort
  }

  select(flight: FlightOption) {
    this.selected = flight
  }

  selectById(id: string) {
    const all = this.allOptions
    this.selected = all.find(f => f.id === id) ?? null
  }

  /** 直飞最低价（价差基准） */
  get directBasePrice(): number {
    const d = this.result?.direct ?? []
    if (d.length === 0) return 0
    return Math.min(...d.map(f => f.totalPrice))
  }

  get allOptions(): FlightOption[] {
    if (!this.result) return []
    return [...this.result.selfTransfer, ...this.result.airlineTransfer, ...this.result.direct]
  }

  /** 当前视图基础列表（未套预算/偏好筛选） */
  private get viewList(): FlightOption[] {
    if (!this.result) return []
    if (this.viewMode === 'self') return [...this.result.selfTransfer]
    if (this.viewMode === 'official') return [...this.result.airlineTransfer, ...this.result.direct]
    return this.allOptions
  }

  /** 当前视图下展示的方案（按预算/中转偏好筛选，按价格或时长排序） */
  get visibleOptions(): FlightOption[] {
    let list = this.viewList
    // 搜索条件筛选：预算区间 + 中转偏好
    const p = this.lastParams
    if (p) {
      const countryPreferences = p.transitCountryPreferences ?? { preferred: [], excluded: [] }
      const [min, max] = p.budgetRange
      list = list.filter(f => f.totalPrice >= min && f.totalPrice <= max)
      if (p.transferPref === 'direct') {
        list = list.filter(f => f.transferType === 'direct')
      } else if (p.transferPref === 'transfer') {
        list = list.filter(f => f.transferType !== 'direct')
      }
      list = list.filter(f => !isExcludedByCountry(f, countryPreferences))
    }
    if (this.sortBy === 'recommended') {
      return sortByRecommendation(list, p?.transitCountryPreferences)
    }
    return list.sort((a, b) => this.sortBy === 'duration' ? a.totalDuration - b.totalDuration : a.totalPrice - b.totalPrice)
  }

  /** 被预算/偏好筛掉的方案数（空态提示用） */
  get filteredOutCount(): number {
    return this.viewList.length - this.visibleOptions.length
  }

  /** 放宽筛选：预算全区间 + 中转不限（仅影响当前结果视图） */
  relaxFilters() {
    if (!this.lastParams) return
    this.lastParams.budgetRange = [500, 20000]
    this.lastParams.transferPref = 'any'
  }

  savingsOf(flight: FlightOption): { amount: number; percent: number } {
    const base = this.directBasePrice
    if (!base || flight.transferType === 'direct') return { amount: 0, percent: 0 }
    const amount = Math.max(0, base - flight.totalPrice)
    return { amount, percent: Math.round((amount / base) * 100) }
  }
}

export const flightStore = new FlightStore()
