// src/stores/chatStore.ts — 需求对话状态
// 对话历史 + 槽位在 tab 切换间保留；ready 后收敛成几个备选攻略，在对话内直接选机票
// 多城指令（尽可能多城市/必去/怎么串）→ 走多城路线规划（LLM 解析 + 路线卡 + 真实价确认）
import { makeAutoObservable, runInAction } from 'mobx'
import { talkToAgent, ChatMessage, ChatSlots } from '../services/chatService'
import { planRoutes, confirmPicks, RoutePick } from '../services/routeService'
import { searchStore } from './searchStore'
import { flightStore } from './flightStore'
import { userStore } from './userStore'
import type { FlightOption } from '../types/flight'

/** 备选攻略卡：一个定位标签 + 对应航班方案 */
export interface PlanCard {
  key: 'save' | 'comfort' | 'play'
  flight: FlightOption
}

/** 多城意图特征：出现任一即走多城路线规划（绕过单程槽位对话） */
const MULTI_INTENT = /多城|尽可能多|多去几个|必须去|必去|\d+\s*个城市|[一二两三四五六七八九十]+\s*个城市|几个城市|串起来|怎么串/

export class ChatStore {
  messages: ChatMessage[] = []
  slots: ChatSlots = {}
  ready = false
  isThinking = false
  /** 收敛出的备选攻略（null=未收敛） */
  planCards: PlanCard[] | null = null
  plansLoading = false
  plansError = ''
  /** 多城路线规划状态 */
  multiPicks: RoutePick[] | null = null
  multiLoading = false
  multiError = ''
  /** 真实价格确认中 */
  multiConfirming = false

  constructor() {
    makeAutoObservable(this)
  }

  /** 发送一条用户消息并等 agent 回复 */
  async send(text: string, locale: 'zh' | 'en') {
    const content = text.trim()
    if (!content || this.isThinking) return
    this.messages = [...this.messages, { role: 'user', content }]
    // 需求可能变化，旧的攻略作废
    this.planCards = null
    this.plansError = ''
    this.multiPicks = null
    this.multiError = ''
    // 多城指令直接走路线规划（LLM 解析），不进单程槽位对话
    if (MULTI_INTENT.test(content)) {
      await this.planMulti(content, locale)
      return
    }
    this.isThinking = true
    try {
      const res = await talkToAgent(this.messages, this.slots)
      runInAction(() => {
        this.messages = [...this.messages, { role: 'assistant', content: locale === 'zh' ? res.reply.zh : res.reply.en }]
        this.slots = res.slots
        this.ready = res.ready
      })
    } catch {
      runInAction(() => {
        this.messages = [
          ...this.messages,
          { role: 'assistant', content: locale === 'zh' ? '刚才走神了，再说一遍？' : 'Sorry, I missed that — could you repeat?' }
        ]
      })
    } finally {
      runInAction(() => {
        this.isThinking = false
      })
    }
  }

  /** 将 agent 拆解的槽位应用到核心检索系统（不发起搜索） */
  private applySlots(): boolean {
    const s = this.slots
    if (!s.origin || !s.destination || !s.depart_date_from) return false

    searchStore.setOrigin(s.origin)
    searchStore.setDestination(s.destination)
    searchStore.setDepartDate(s.depart_date_from)
    searchStore.setDepartDateEnd(s.depart_date_to ?? s.depart_date_from)
    searchStore.setTripType(s.trip_type ?? 'roundtrip')
    if (s.stay_min != null && s.stay_max != null && s.stay_max > 0) {
      searchStore.setStay(s.stay_min, s.stay_max)
    }
    if (s.budget_max) searchStore.setBudget(Math.min(searchStore.budgetMin, s.budget_max), s.budget_max)
    if (s.transfer_pref) searchStore.setTransferPref(s.transfer_pref)
    if (s.interests?.length) {
      // 覆盖式应用兴趣（先清空再逐个开启）
      for (const i of [...searchStore.interests]) searchStore.toggleInterest(i)
      for (const i of s.interests) searchStore.toggleInterest(i)
    }
    return true
  }

  /** 从候选方案里收敛出备选攻略：最省钱 / 最舒适 / 顺路玩中转（去重，最多 3 张） */
  private buildPlanCards(): PlanCard[] {
    // 尊重预算与中转偏好；全被筛掉时退化为全部方案，避免空手而归
    const pool = flightStore.visibleOptions.length > 0 ? flightStore.visibleOptions : flightStore.allOptions
    if (pool.length === 0) return []
    const cards: PlanCard[] = []
    const used = new Set<string>()

    // 最省钱：价格最低
    const save = [...pool].sort((a, b) => a.totalPrice - b.totalPrice)[0]
    cards.push({ key: 'save', flight: save })
    used.add(save.id)

    // 最舒适：全程最短（同价取短），与最省钱重复则跳过
    const comfort = [...pool]
      .sort((a, b) => a.totalDuration - b.totalDuration || a.totalPrice - b.totalPrice)
      .find(f => !used.has(f.id))
    if (comfort) {
      cards.push({ key: 'comfort', flight: comfort })
      used.add(comfort.id)
    }

    // 顺路玩中转：停留≥8小时的方案里挑最便宜，重复或没有则不出这张卡
    const play = [...pool]
      .filter(f => f.hub && f.hub.layoverMinutes >= 480 && !used.has(f.id))
      .sort((a, b) => a.totalPrice - b.totalPrice)[0]
    if (play) cards.push({ key: 'play', flight: play })

    return cards
  }

  /** 对话内收敛：搜索 → 生成备选攻略卡（不跳页） */
  async converge(locale: 'zh' | 'en') {
    if (!this.applySlots() || this.plansLoading) return
    this.plansLoading = true
    this.plansError = ''
    this.planCards = null
    try {
      userStore.addHistory(searchStore.params)
      await flightStore.search(searchStore.params)
      runInAction(() => {
        this.planCards = this.buildPlanCards()
        this.plansLoading = false
        if (this.planCards.length === 0) {
          this.messages = [
            ...this.messages,
            {
              role: 'assistant',
              content: locale === 'zh' ? '这条线没搜到合适的航班，试试放宽预算或换个日期？' : 'No matching flights — try relaxing the budget or dates?'
            }
          ]
        }
      })
    } catch {
      runInAction(() => {
        this.plansError = locale === 'zh' ? '搜索失败，请重试' : 'Search failed, please retry'
        this.plansLoading = false
      })
    }
  }

  /** 选中一张攻略卡的机票 → 行程规划页自动切换到行程生成形态 */
  pickPlan(flight: FlightOption) {
    flightStore.select(flight)
  }

  /** 多城路线规划：智能解析 → 搜索 → 收敛出路线卡（追问/冲突/提示以对话气泡呈现） */
  async planMulti(text: string, locale: 'zh' | 'en') {
    if (this.multiLoading) return
    this.multiLoading = true
    this.multiError = ''
    this.multiPicks = null
    const say = (content: string) => {
      runInAction(() => {
        this.messages = [...this.messages, { role: 'assistant', content }]
      })
    }
    try {
      const today = new Date().toISOString().slice(0, 10)
      const res = await planRoutes(text, today)
      const zh = locale === 'zh'
      if (res.missing.length > 0) {
        const names: Record<string, [string, string]> = {
          origin: ['出发城市', 'departure city'],
          window: ['出行日期范围', 'travel dates'],
          travel_days: ['可玩天数', 'number of travel days']
        }
        const list = res.missing.map(m => (zh ? names[m]?.[0] : names[m]?.[1]) ?? m).join('、')
        say(zh ? `还差 ${list}，补充一下我再帮你排路线。` : `I still need: ${list}. Add that and I'll plan the route.`)
      }
      for (const c of res.conflicts) say(zh ? c.zh : c.en)
      for (const n of res.notes) say(zh ? n.zh : n.en)
      runInAction(() => {
        this.multiPicks = res.routes.length > 0 ? res.routes : null
        this.multiLoading = false
      })
      if (res.routes.length === 0 && res.missing.length === 0 && res.conflicts.length === 0) {
        say(zh ? '这个条件没排出合适路线，试试放宽预算或延长天数？' : 'No viable route under these constraints — try a bigger budget or more days?')
      }
    } catch {
      runInAction(() => {
        this.multiError = locale === 'zh' ? '规划失败，请重试' : 'Planning failed, please retry'
        this.multiLoading = false
      })
    }
  }

  /** 对当前路线卡做真实价格确认（逐段 SerpApi 探测） */
  async confirmMulti() {
    if (!this.multiPicks || this.multiConfirming) return
    this.multiConfirming = true
    try {
      const confirmed = await confirmPicks(this.multiPicks)
      runInAction(() => {
        this.multiPicks = confirmed
      })
    } finally {
      runInAction(() => {
        this.multiConfirming = false
      })
    }
  }

  reset() {
    this.messages = []
    this.slots = {}
    this.ready = false
    this.planCards = null
    this.plansLoading = false
    this.plansError = ''
    this.multiPicks = null
    this.multiLoading = false
    this.multiError = ''
    this.multiConfirming = false
  }
}

export const chatStore = new ChatStore()
