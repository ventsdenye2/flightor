// src/mocks/deals.ts — 热门低价航线（Mock 静态展示，首页/探索页共用）
export interface HotRoute {
  from: string
  to: string
  via: string
  price: number
  save: number
}

export const HOT_ROUTES: HotRoute[] = [
  { from: 'PVG', to: 'LHR', via: 'SIN', price: 3200, save: 41 },
  { from: 'PEK', to: 'CDG', via: 'DOH', price: 3450, save: 38 },
  { from: 'CAN', to: 'FRA', via: 'IST', price: 2980, save: 36 },
  { from: 'PVG', to: 'JFK', via: 'HEL', price: 4100, save: 33 },
  { from: 'SZX', to: 'SYD', via: 'KUL', price: 1980, save: 40 }
]

/** TOGO 优先排序：想去的目的地排前，其余保持原序 */
export function sortByTogo(routes: HotRoute[], togo: string[]): HotRoute[] {
  return [...routes].sort((a, b) => Number(togo.includes(b.to)) - Number(togo.includes(a.to)))
}
