// src/services/routeService.ts — 多城机票路线规划服务
// 调用路径：云函数 routePlanner 优先（服务端注入 key）→ 失败降级本地直调（引擎同构）；
// 本地路径：智能解析（LLM 带规则兜底）+ 估算价搜索；confirmPicks 逐段 SerpApi 真实探测确认
import Taro from '@tarojs/taro'
import { callCloud } from '../utils/cloud'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const engine = require('../../cloud/routePlanner/engine') as {
  parseDirective: (text: string, today: string) => DirectiveParseResult
  searchRoutes: (slots: RouteSlots, opts?: unknown) => RouteResult[]
  convergeRoutes: (routes: RouteResult[]) => RoutePick[]
  SCHENGEN_CITIES: CityMeta[]
  VISA_FREE_CITIES: CityMeta[]
  ORIGINS: CityMeta[]
}

/** 城市元数据（引擎城市池条目） */
interface CityMeta {
  iata: string
  city: string
  enCity: string
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const probe = require('../../cloud/routePlanner/probe') as {
  confirmPickRoute: (apiKey: string, pick: RoutePick, opts?: { fetchJson?: (url: string) => Promise<unknown>; maxCalls?: number }) => Promise<ConfirmedPick>
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const llmParse = require('../../cloud/routePlanner/llmParse') as {
  parseDirectiveSmart: (apiKey: string, text: string, today: string, opts?: { fetchJson?: (url: string, init?: LlmFetchInit) => Promise<unknown> }) => Promise<DirectiveParseResult & { source: 'llm' | 'rules'; llmError?: string }>
}

/** llmParse 注入的 fetch 参数（POST JSON） */
interface LlmFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

/** 多城需求槽位 */
export interface RouteSlots {
  origin: string | null
  window_from: string | null
  window_to: string | null
  travel_days: number | null
  region: string | null
  visa: string | null
  must_visit: string[]
  overnight_pref: boolean
  direct_only: boolean
  budget_max: number | null
  city_target: number | null
}

/** 单段航班 */
export interface RouteLeg {
  from: string
  to: string
  date: string
  departTime: string
  arriveTime: string
  crossDay: boolean
  duration: number
  price: number
  airline: string
  /** 真实探测段附带 */
  flightNo?: string
  stops?: number
  /** true=实时报价 false/缺省=估算价 */
  real?: boolean
}

/** 一条候选路线 */
export interface RouteResult {
  cities: string[]
  citySeq: string[]
  legs: RouteLeg[]
  totalPrice: number
  effCost: number
  nightsSaved: number
  /** 含真实报价段 */
  hasReal?: boolean
}

/** 收敛后的差异化路线 */
export interface RoutePick {
  kind: 'cheapest' | 'mostCities' | 'mostNights'
  route: RouteResult
}

/** 真实价格确认后的路线 */
export interface ConfirmedPick extends RoutePick {
  probed: number
  failed: number
  note: string
}

export interface DirectiveParseResult {
  slots: RouteSlots
  missing: string[]
  conflicts: Array<{ zh: string; en: string }>
  /** 非阻断提示（如签证切换候选池），不拦截搜索 */
  notes: Array<{ zh: string; en: string }>
  /** 解析来源：llm=大模型 rules=本地规则兜底 */
  source?: 'llm' | 'rules'
  /** LLM 失败回退时的错误信息 */
  llmError?: string
}

/** 解析长指令（缺失字段 → 追问；冲突 → 显式提示，不硬出方案） */
export function parseDirective(text: string, today: string): DirectiveParseResult {
  return engine.parseDirective(text, today)
}

/** Taro 版 POST fetchJson（LLM 解析用；超时放宽 30s） */
async function taroFetchJsonLLM(url: string, init?: LlmFetchInit): Promise<unknown> {
  const res = await Taro.request({
    url,
    method: 'POST',
    header: init?.headers,
    data: init?.body || '',
    timeout: 30000
  })
  if (res.statusCode !== 200) throw new Error(`openrouter ${res.statusCode}`)
  return res.data
}

/**
 * 智能解析：有 OpenRouter key 优先 LLM，失败自动回退本地规则（source 标记来源）
 */
export async function parseDirectiveSmart(text: string, today: string): Promise<DirectiveParseResult> {
  const key = typeof OPENROUTER_KEY === 'string' ? OPENROUTER_KEY : ''
  return llmParse.parseDirectiveSmart(key, text, today, { fetchJson: taroFetchJsonLLM })
}

/** 云函数 action=plan 成功返回结构（失败为 {statusCode, body}） */
interface PlanCloudResult extends DirectiveParseResult {
  routes: RoutePick[]
  statusCode?: undefined
}

/**
 * 端到端规划：优先云函数 routePlanner（服务端 key 齐全）→ 失败降级本地直调（引擎同构）
 * @returns missing/conflicts 非空时 routes 为空，调用方先处理追问或冲突
 */
export async function planRoutes(text: string, today: string): Promise<DirectiveParseResult & { routes: RoutePick[] }> {
  // ① 云函数优先
  const cloudRes = await callCloud<PlanCloudResult | { statusCode: number }>('routePlanner', { action: 'plan', text, today })
  if (cloudRes && cloudRes.statusCode === undefined) {
    return cloudRes
  }

  // ② 本地降级：智能解析 → 校验 → 搜索 → 收敛
  const parsed = await parseDirectiveSmart(text, today)
  if (parsed.missing.length > 0 || parsed.conflicts.length > 0) {
    return { ...parsed, routes: [] }
  }
  const routes = engine.searchRoutes(parsed.slots)
  return { ...parsed, routes: engine.convergeRoutes(routes) }
}

/** IATA → 城市名（跨三个池查找；未知返回 IATA 原样） */
export function cityByIata(iata: string, locale: 'zh' | 'en'): string {
  for (const pool of [engine.SCHENGEN_CITIES, engine.VISA_FREE_CITIES, engine.ORIGINS]) {
    const c = pool.find(x => x.iata === iata)
    if (c) return locale === 'zh' ? c.city : c.enCity
  }
  return iata
}

/** Taro 版 fetchJson（单段抓取实测约 10s，超时放宽 30s） */
async function taroFetchJson(url: string): Promise<unknown> {
  const res = await Taro.request({ url, method: 'GET', timeout: 30000 })
  if (res.statusCode !== 200) throw new Error(`serpapi ${res.statusCode}`)
  return res.data
}

/**
 * 对收敛出的推荐路线做真实价格确认（P2）
 * 优先云函数（服务端 SERPAPI_KEY）→ 失败降级本地探测 → 无 key 返回估算价标记
 */
export async function confirmPicks(picks: RoutePick[]): Promise<ConfirmedPick[]> {
  // ① 云函数优先
  const cloudRes = await callCloud<{ confirmed?: ConfirmedPick[]; statusCode?: number }>('routePlanner', { action: 'confirm', picks })
  if (cloudRes && Array.isArray(cloudRes.confirmed)) {
    return cloudRes.confirmed
  }

  // ② 本地降级：有 key 逐段探测；无 key 原样返回估算价结果
  if (typeof SERPAPI_KEY !== 'string' || SERPAPI_KEY.length === 0) {
    return picks.map(p => ({ ...p, probed: 0, failed: p.route.legs.length, note: '当前为估算价' }))
  }
  return Promise.all(picks.map(p => probe.confirmPickRoute(SERPAPI_KEY, p, { fetchJson: taroFetchJson })))
}
