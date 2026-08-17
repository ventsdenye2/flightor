// src/stores/userStore.ts — 收藏/历史/设置（持久化到本地缓存）
import { makeAutoObservable } from 'mobx'
import type { FlightOption, SearchParams } from '../types/flight'
import { getStorage, setStorage } from '../utils/storage'

export interface FavoriteItem {
  id: string
  flight: FlightOption
  savedAt: string
}

export interface HistoryItem {
  params: SearchParams
  searchedAt: string
}

export interface PriceAlert {
  id: string
  origin: string
  destination: string
  targetPrice: number
  createdAt: string
}

export class UserStore {
  favorites: FavoriteItem[] = getStorage<FavoriteItem[]>('favorites', [])
  history: HistoryItem[] = getStorage<HistoryItem[]>('history', [])
  alerts: PriceAlert[] = getStorage<PriceAlert[]>('alerts', [])
  // TOGO 清单：想去的目的地（IATA），低价信息流优先展示
  togo: string[] = getStorage<string[]>('togo', [])

  constructor() {
    makeAutoObservable(this)
  }

  isTogo(iata: string): boolean {
    return this.togo.includes(iata)
  }

  addTogo(iata: string) {
    if (this.isTogo(iata)) return
    this.togo = [iata, ...this.togo].slice(0, 30)
    setStorage('togo', this.togo)
  }

  removeTogo(iata: string) {
    this.togo = this.togo.filter(x => x !== iata)
    setStorage('togo', this.togo)
  }

  isFavorite(flightId: string): boolean {
    return this.favorites.some(f => f.id === flightId)
  }

  toggleFavorite(flight: FlightOption) {
    if (this.isFavorite(flight.id)) {
      this.favorites = this.favorites.filter(f => f.id !== flight.id)
    } else {
      this.favorites = [{ id: flight.id, flight, savedAt: new Date().toISOString() }, ...this.favorites].slice(0, 50)
    }
    setStorage('favorites', this.favorites)
  }

  addHistory(params: SearchParams) {
    // 同路线去重，最新在前
    this.history = [
      { params, searchedAt: new Date().toISOString() },
      ...this.history.filter(h => !(h.params.origin === params.origin && h.params.destination === params.destination))
    ].slice(0, 20)
    setStorage('history', this.history)
  }

  clearHistory() {
    this.history = []
    setStorage('history', this.history)
  }

  addAlert(alert: Omit<PriceAlert, 'id' | 'createdAt'>) {
    this.alerts = [
      { ...alert, id: `alert-${Date.now()}`, createdAt: new Date().toISOString() },
      ...this.alerts
    ].slice(0, 20)
    setStorage('alerts', this.alerts)
  }

  removeAlert(id: string) {
    this.alerts = this.alerts.filter(a => a.id !== id)
    setStorage('alerts', this.alerts)
  }
}

export const userStore = new UserStore()
