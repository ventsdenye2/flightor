// cloud/routePlanner/engine.js — 多城机票路线规划引擎（纯逻辑，可本地单测）
// 职责：长指令解析（多城槽位 + 追问/冲突检测）→ 树状搜索（分支定界）→ 收敛差异化路线
// P1 阶段价格来自 mockLegs；P2 替换为 SerpApi 真实探测（同签名即可）
// 原则：不编造——城市必须来自城市池，价格必须来自价格函数

// ===== 城市池 =====
// 申根热门城市（经纬度用于地理回溯剪枝）
const SCHENGEN_CITIES = [
  { iata: 'CDG', city: '巴黎', enCity: 'Paris', country: '法国', lat: 49.0097, lng: 2.5479 },
  { iata: 'AMS', city: '阿姆斯特丹', enCity: 'Amsterdam', country: '荷兰', lat: 52.3105, lng: 4.7683 },
  { iata: 'FRA', city: '法兰克福', enCity: 'Frankfurt', country: '德国', lat: 50.0379, lng: 8.5622 },
  { iata: 'MUC', city: '慕尼黑', enCity: 'Munich', country: '德国', lat: 48.3538, lng: 11.7861 },
  { iata: 'ZRH', city: '苏黎世', enCity: 'Zurich', country: '瑞士', lat: 47.4582, lng: 8.5556 },
  { iata: 'VIE', city: '维也纳', enCity: 'Vienna', country: '奥地利', lat: 48.1103, lng: 16.5697 },
  { iata: 'PRG', city: '布拉格', enCity: 'Prague', country: '捷克', lat: 50.1008, lng: 14.26 },
  { iata: 'FCO', city: '罗马', enCity: 'Rome', country: '意大利', lat: 41.8003, lng: 12.2389 },
  { iata: 'MXP', city: '米兰', enCity: 'Milan', country: '意大利', lat: 45.6306, lng: 8.7281 },
  { iata: 'BCN', city: '巴塞罗那', enCity: 'Barcelona', country: '西班牙', lat: 41.2974, lng: 2.0833 },
  { iata: 'MAD', city: '马德里', enCity: 'Madrid', country: '西班牙', lat: 40.4983, lng: -3.5676 },
  { iata: 'LIS', city: '里斯本', enCity: 'Lisbon', country: '葡萄牙', lat: 38.7742, lng: -9.1342 },
  { iata: 'ATH', city: '雅典', enCity: 'Athens', country: '希腊', lat: 37.9364, lng: 23.9445 },
  { iata: 'BUD', city: '布达佩斯', enCity: 'Budapest', country: '匈牙利', lat: 47.4372, lng: 19.2556 },
  { iata: 'CPH', city: '哥本哈根', enCity: 'Copenhagen', country: '丹麦', lat: 55.618, lng: 12.656 },
  { iata: 'HEL', city: '赫尔辛基', enCity: 'Helsinki', country: '芬兰', lat: 60.3172, lng: 24.9633 }
]

// 免签/落地签城市池（无申根签时的替代候选，中国护照视角）
const VISA_FREE_CITIES = [
  { iata: 'BKK', city: '曼谷', enCity: 'Bangkok', country: '泰国', lat: 13.69, lng: 100.7501 },
  { iata: 'KUL', city: '吉隆坡', enCity: 'Kuala Lumpur', country: '马来西亚', lat: 2.7456, lng: 101.7099 },
  { iata: 'SIN', city: '新加坡', enCity: 'Singapore', country: '新加坡', lat: 1.3644, lng: 103.9915 },
  { iata: 'HAN', city: '河内', enCity: 'Hanoi', country: '越南', lat: 21.2212, lng: 105.807 },
  { iata: 'SGN', city: '胡志明市', enCity: 'Ho Chi Minh City', country: '越南', lat: 10.8108, lng: 106.6519 },
  { iata: 'DPS', city: '巴厘岛', enCity: 'Bali', country: '印度尼西亚', lat: -8.7482, lng: 115.1672 },
  { iata: 'BEG', city: '贝尔格莱德', enCity: 'Belgrade', country: '塞尔维亚', lat: 44.8182, lng: 20.3091 },
  { iata: 'IST', city: '伊斯坦布尔', enCity: 'Istanbul', country: '土耳其', lat: 41.2753, lng: 28.7519 },
  { iata: 'CJU', city: '济州岛', enCity: 'Jeju', country: '韩国', lat: 33.5113, lng: 126.493 }
]

// 国内出发城市
const ORIGINS = [
  { iata: 'SZX', city: '深圳', enCity: 'Shenzhen', lat: 22.6393, lng: 113.8107 },
  { iata: 'CAN', city: '广州', enCity: 'Guangzhou', lat: 23.3924, lng: 113.2988 },
  { iata: 'PVG', city: '上海', enCity: 'Shanghai', lat: 31.1443, lng: 121.8083 },
  { iata: 'PEK', city: '北京', enCity: 'Beijing', lat: 40.0799, lng: 116.6031 },
  { iata: 'CTU', city: '成都', enCity: 'Chengdu', lat: 30.3125, lng: 104.4419 },
  { iata: 'HKG', city: '香港', enCity: 'Hong Kong', lat: 22.308, lng: 113.9185 }
]

// ===== 工具 =====
function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function distKm(a, b) {
  const toRad = x => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

const NIGHT_START = 20 // 20:00 后起飞算夜航出发
const NIGHT_END = 9 // 09:00 前到达算夜航到达
const LODGING_CNY = 400 // 一晚住宿等效成本，夜航段从总成本中扣减

function isNightLeg(leg) {
  const dep = Number(leg.departTime.slice(0, 2))
  const arr = Number(leg.arriveTime.slice(0, 2))
  return dep >= NIGHT_START && (arr < NIGHT_END || leg.crossDay)
}

// ===== M1 长指令解析（本地规则版，P2 换 LLM 同结构输出） =====

const NUM_ZH = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function parseNum(s) {
  if (/^\d+$/.test(s)) return Number(s)
  if (NUM_ZH[s] != null) return NUM_ZH[s]
  // "十N" / "N十" / "N十N"
  const m = s.match(/^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/)
  if (m) return (m[1] ? NUM_ZH[m[1]] : 1) * 10 + (m[2] ? NUM_ZH[m[2]] : 0)
  return null
}

/**
 * 解析长指令 → 多城槽位
 * @param text 用户指令原文
 * @param today yyyy-mm-dd
 * @returns {{ slots, missing: string[], conflicts: [{zh,en}] }}
 */
function parseDirective(text, today) {
  const slots = {
    origin: null, // 国内出发城市 IATA
    window_from: null, // 假期窗口起 yyyy-mm-dd
    window_to: null, // 假期窗口止
    travel_days: null, // 可玩天数
    region: null, // 'schengen'
    visa: null, // 'schengen' | 'none'
    must_visit: [], // 必去城市 IATA
    overnight_pref: false, // 夜航省住宿偏好
    direct_only: false,
    budget_max: null,
    city_target: null // 目标城市数（"尽可能多"→null，由搜索决定上限）
  }
  const missing = []
  const conflicts = []
  const notes = [] // 非阻断提示（不拦截搜索，仅告知用户）
  const year = Number(today.slice(0, 4))

  // 出发城市：「X出发」（X 限定为国内出发城市名；多处出现时取第一个命中的国内城市）
  for (const m of text.matchAll(/([^\s，。！？,]{2,6}?)出发/g)) {
    const c = ORIGINS.find(o => m[1].includes(o.city))
    if (c) {
      slots.origin = c.iata
      break
    }
  }

  // 假期窗口：「X月Y号/日到A月B号/日之间」或「X月Y号到Z号」
  const winM =
    text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?\s*(?:到|至|-|~)\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?/) ||
    text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?\s*(?:到|至|-|~)\s*(\d{1,2})\s*[号日]?/)
  if (winM) {
    const m1 = Number(winM[1])
    const d1 = Number(winM[2])
    let m2, d2
    if (winM.length >= 5 && winM[3] && winM[4]) {
      m2 = Number(winM[3])
      d2 = Number(winM[4])
    } else {
      m2 = m1
      d2 = Number(winM[3])
    }
    const pad = n => String(n).padStart(2, '0')
    let from = `${year}-${pad(m1)}-${pad(d1)}`
    let to = `${year}-${pad(m2)}-${pad(d2)}`
    if (from < today) {
      from = `${year + 1}-${pad(m1)}-${pad(d1)}`
      to = `${year + 1}-${pad(m2)}-${pad(d2)}`
    }
    if (from <= to) {
      slots.window_from = from
      slots.window_to = to
    }
  } else {
    // 「X月初/中旬/月底」模糊窗口：初→1-5日，中(旬)→12-18日，底→25-28日
    const fuzzyM = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*月\s*(初|中旬|中|底)/)
    if (fuzzyM) {
      const m = parseNum(fuzzyM[1])
      const span = { 初: [1, 5], 中: [12, 18], 中旬: [12, 18], 底: [25, 28] }[fuzzyM[2]]
      const pad = n => String(n).padStart(2, '0')
      let from = `${year}-${pad(m)}-${pad(span[0])}`
      let to = `${year}-${pad(m)}-${pad(span[1])}`
      if (from < today) {
        from = `${year + 1}-${pad(m)}-${pad(span[0])}`
        to = `${year + 1}-${pad(m)}-${pad(span[1])}`
      }
      slots.window_from = from
      slots.window_to = to
    }
  }

  // 可玩天数：优先匹配「其中/有N天(可以)?出去玩/旅行/玩」，其次「X-Y天假期」
  const playM = text.match(/(?:其中|有)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*(?:可以)?(?:出去玩|出行|旅行|游玩|玩)/)
  const playM2 = text.match(/玩\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天/) // 「玩N天」语序
  if (playM) {
    slots.travel_days = parseNum(playM[1])
  } else if (playM2) {
    slots.travel_days = parseNum(playM2[1])
  } else {
    const vacM = text.match(/(\d{1,2})\s*[-~到至]\s*(\d{1,2})\s*天\s*(?:的)?假期/)
    if (vacM) slots.travel_days = Math.round((Number(vacM[1]) + Number(vacM[2])) / 2)
    else {
      const singleM = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*(?:假期|假|时间)/)
      if (singleM) slots.travel_days = parseNum(singleM[1])
      else {
        // 「X月(初/中旬/底)?N天」兜底（如"十月中旬10天"）
        const monthDaysM = text.match(/月\s*(?:初|中旬|中|底)?\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天/)
        if (monthDaysM) slots.travel_days = parseNum(monthDaysM[1])
        else {
          // 结尾裸「N天」兜底（如"…9月4号到9月6号3天"）
          const tailM = text.match(/(?:^|[，,。\s号日])(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*$/)
          if (tailM) slots.travel_days = parseNum(tailM[1])
          else {
            // 逗号夹注「，8天，」（前后无动词/假期字样）
            const commaM = text.match(/[，,]\s*(\d{1,2}|[一二两三四五六七八九十]+)\s*天\s*[，,。]/)
            if (commaM) slots.travel_days = parseNum(commaM[1])
          }
        }
      }
    }
  }

  // 区域与签证
  if (/申根/.test(text)) {
    if (/没有申根|无申根|没申根/.test(text)) slots.visa = 'none'
    else {
      slots.visa = 'schengen'
      slots.region = 'schengen'
    }
  }
  if (/欧洲/.test(text) && !slots.region) slots.region = 'schengen' // 默认欧洲按申根池（英国不在池内）
  // 无申根签：候选池切换为免签/落地签国家（Case 6）
  if (slots.visa === 'none') {
    slots.region = 'visa_free'
    notes.push({
      zh: '没有申根签，候选城市已切换为免签/落地签目的地（曼谷、新加坡、吉隆坡、贝尔格莱德等），欧洲申根城市暂不可达。',
      en: 'Without a Schengen visa, candidates switched to visa-free destinations (Bangkok, Singapore, Kuala Lumpur, Belgrade…). Schengen cities are out of reach.'
    })
  }

  // 必去城市：「X必须去/X和Y必须去」（在按签证选定的城市池内查找）
  const mustPool = slots.region === 'visa_free' ? VISA_FREE_CITIES : SCHENGEN_CITIES
  const mustM = text.match(/([\u4e00-\u9fa5]{2,4}?)(?:和|与|、)([\u4e00-\u9fa5]{2,4}?)必须去/)
  if (mustM) {
    for (const name of [mustM[1], mustM[2]]) {
      const c = mustPool.find(x => x.city === name)
      if (c && !slots.must_visit.includes(c.iata)) slots.must_visit.push(c.iata)
    }
  } else {
    // 前置「苏黎世必(须)去」或后置「必(须)去苏黎世」
    const must1 = text.match(/([\u4e00-\u9fa5]{2,4}?)(?:必须去|必去)/) || text.match(/必(?:须)?去([\u4e00-\u9fa5]{2,4})/)
    if (must1) {
      const c = mustPool.find(x => x.city === must1[1])
      if (c) slots.must_visit.push(c.iata)
    }
  }

  // 偏好
  if (/晚.*(飞|航班|飞机).*(早|晨)|夜航|红眼|省.*住宿/.test(text)) slots.overnight_pref = true
  if (/只要直飞|全部(?:要|都)?直飞|都直飞|仅直飞/.test(text)) slots.direct_only = true
  // 显式城市数：「4个城市/去四个城市」（"尽可能多"类表达保持 null）
  const explicitCityM = text.match(/(\d{1,2}|[一二两三四五六七八九十]+)\s*个\s*(?:欧洲)?城市/)
  if (explicitCityM) slots.city_target = parseNum(explicitCityM[1])
  if (/尽可能多|越多越好|多去几个|多城/.test(text)) slots.city_target = null

  const budgetM = text.match(/预算\s*(\d+(?:\.\d+)?)\s*[万w]/)
  if (budgetM) slots.budget_max = Math.round(Number(budgetM[1]) * 10000)
  else {
    // 中文数字：「预算一万五」→15000、「预算两万」→20000、「预算八千」→8000
    const budgetZhWan = text.match(/预算\s*([一二两三四五六七八九十]+)\s*万\s*([一二两三四五六七八九]?)\s*千?/)
    if (budgetZhWan) {
      const wan = parseNum(budgetZhWan[1]) * 10000
      const tail = budgetZhWan[2] ? parseNum(budgetZhWan[2]) * 1000 : 0
      slots.budget_max = wan + tail
    } else {
      const budgetZhQian = text.match(/预算\s*([一二两三四五六七八九十]+)\s*千/)
      if (budgetZhQian) slots.budget_max = parseNum(budgetZhQian[1]) * 1000
      else {
        const budgetM2 = text.match(/预算\s*(\d{3,6})/)
        if (budgetM2) slots.budget_max = Number(budgetM2[1])
      }
    }
  }

  // 缺失与冲突检测（与 LLM 解析共用同一套判定）
  const { missing: m2, conflicts: c2 } = validateSlots(slots)
  missing.push(...m2)
  conflicts.push(...c2)

  return { slots, missing, conflicts, notes }
}

/**
 * 槽位完整性与冲突判定（规则解析与 LLM 解析共用）
 * 缺失：origin/window/travel_days 任一为空
 * 冲突：显式城市数超天数容量；"全部直飞"与多城中转现实矛盾
 */
function validateSlots(slots) {
  const missing = []
  const conflicts = []
  if (!slots.origin) missing.push('origin')
  if (!slots.window_from) missing.push('window')
  if (!slots.travel_days) missing.push('travel_days')

  const wantCities = slots.city_target
  if (wantCities && slots.travel_days) {
    // 每个城市至少 1 晚在地面；夜航最多帮省 ceil(段数/2) 晚
    const capacity = slots.travel_days
    if (wantCities > capacity) {
      conflicts.push({
        zh: `${slots.travel_days} 天最多覆盖约 ${capacity} 个城市（每城至少停留 1 天），${wantCities} 个城市安排不下。建议减少城市数或延长行程。`,
        en: `${slots.travel_days} days can cover about ${capacity} cities at most. ${wantCities} cities won't fit — try fewer cities or more days.`
      })
    }
  }
  if (slots.direct_only && (slots.region === 'schengen' || slots.must_visit.length > 0)) {
    conflicts.push({
      zh: '欧洲城市间航线以中转联程为主，"全部直飞"会大幅减少可行路线。建议接受中转，或只保留 1-2 个必去城市。',
      en: 'Most intra-Europe routes require a connection. "Direct only" will rule out most itineraries — consider accepting transfers.'
    })
  }
  return { missing, conflicts }
}

// ===== Mock 价格（P2 起被真实探测替换，legsFn 注入同构数据） =====

/**
 * 生成某 OD 某日期的候选航班段（确定性 mock）
 * P2 真实探测时由 legsFn 注入同构数据（含真实起降时刻，夜航判定依然生效）
 * @param legsFn 可选注入，签名 (fromCity, toCity, date) → 段数组；返回空则回退 mock
 * @returns 2-3 个候选段，含出发/到达时刻
 */
function mockLegs(from, to, date, legsFn) {
  if (typeof legsFn === 'function') {
    const real = legsFn(from, to, date)
    if (Array.isArray(real) && real.length > 0) return real
  }
  const h = hashStr(`${from.iata}|${to.iata}|${date}`)
  const isLongHaul = distKm(from, to) > 4000
  const legs = []
  const count = 2 + (h % 2)

  for (let i = 0; i < count; i++) {
    const hh = hashStr(`${from.iata}|${to.iata}|${date}|${i}`)
    let depHour, durH
    if (isLongHaul) {
      // 长途：09-13 白天班 或 22-23 夜航班（夜航约 1/3 概率）
      depHour = hh % 3 === 0 ? 22 + (hh % 2) : 9 + (hh % 5)
      durH = 11 + (hh % 4)
    } else {
      // 欧洲内短途：07-21 点，含 20-21 晚班
      depHour = 7 + (hh % 15)
      durH = 1 + (hh % 3)
    }
    const base = isLongHaul ? 2600 + (hh % 2400) : 220 + (hh % 680)
    const price = Math.round(base * (0.9 + (hh % 30) / 100))

    const arrTotalMin = depHour * 60 + durH * 60 + (hh % 50)
    const crossDay = arrTotalMin >= 24 * 60
    const arrDay = crossDay ? arrTotalMin - 24 * 60 : arrTotalMin

    legs.push({
      from: from.iata,
      to: to.iata,
      date,
      departTime: `${String(depHour).padStart(2, '0')}:${String((hh % 4) * 15).padStart(2, '0')}`,
      arriveTime: `${String(Math.floor(arrDay / 60)).padStart(2, '0')}:${String(arrDay % 60).padStart(2, '0')}`,
      crossDay,
      duration: durH * 60 + (hh % 50),
      price,
      airline: isLongHaul ? 'CA' : ['FR', 'U2', 'LH', 'AF'][hh % 4]
    })
  }
  return legs
}

// ===== M4 树状搜索（分支定界） =====

/**
 * 城市池预选（Top-K 启发）：必去城市必进，其余按地理中心性（到其他城市距离和）升序取。
 * 目的：控制搜索空间（16 城全排列会爆），同时中心性高的城市串线更不容易回溯。
 */
function selectPool(slots, opts = {}) {
  const k = opts.poolSize || 8
  // 无申根签 → 免签池；否则申根池
  const defaultSet = slots.visa === 'none' || slots.region === 'visa_free' ? VISA_FREE_CITIES : SCHENGEN_CITIES
  const all = opts.allCities || defaultSet
  const pool = []
  for (const m of slots.must_visit || []) {
    const c = all.find(x => x.iata === m)
    if (c) pool.push(c)
  }
  const scored = all
    .filter(c => !pool.some(p => p.iata === c.iata))
    .map(c => ({ c, s: all.reduce((t, o) => (o.iata === c.iata ? t : t + distKm(c, o)), 0) }))
    .sort((a, b) => a.s - b.s)
  for (const { c } of scored) {
    if (pool.length >= k) break
    pool.push(c)
  }
  return pool
}

/**
 * 多城路线搜索
 * 模型：每个城市停留 1-2 晚（分支），夜航段等效扣减住宿成本；
 *       方案在任意城市数 ≥2 处都可收尾（回程），搜索同时产出不同城市数的方案供收敛。
 * @param slots parseDirective 输出的槽位（需 origin/window_from/window_to/travel_days 齐全）
 * @param opts { cities?: 城市池, legsFn?: 注入真实航班段, lodgingCny?: 住宿等效成本 }
 * @returns 路线数组（按 effCost 升序），每条含 legs/cities/citySeq/totalPrice/effCost/nightsSaved
 */
function searchRoutes(slots, opts = {}) {
  // 必要槽位不全直接返回空（由调用方走追问流程），避免 NaN 进入剪枝比较
  if (!slots.origin || !slots.window_from || !slots.window_to || !slots.travel_days) return []
  const cities = opts.cities || selectPool(slots, opts)
  const lodging = opts.lodgingCny != null ? opts.lodgingCny : LODGING_CNY
  const origin = ORIGINS.find(o => o.iata === slots.origin) || { iata: slots.origin, lat: 22.6, lng: 113.8 }

  const legCache = {}
  const legsFor = (a, b, date) => {
    const k = `${a.iata}|${b.iata}|${date}`
    if (!legCache[k]) legCache[k] = mockLegs(a, b, date, opts.legsFn)
    return legCache[k]
  }
  /** 取该 OD 该日期成本最优段（夜航偏好时按 effCost 比较） */
  const bestLeg = (a, b, date) => {
    const list = legsFor(a, b, date)
    return list.reduce((m, l) => {
      const eff = l.price - (slots.overnight_pref && isNightLeg(l) ? lodging : 0)
      const mEff = m.price - (slots.overnight_pref && isNightLeg(m) ? lodging : 0)
      return eff < mEff ? l : m
    })
  }

  // 地面停留晚数分支：夜航偏好时偏向 1 晚（白天玩晚上飞）
  const stayOptions = slots.overnight_pref ? [1, 2] : [2, 1]
  // 城市数上限：每城至少 1 晚 + 回程预留 1 天；池子再大也不超过 6 城（产品上限）
  const maxCities = Math.min(slots.city_target || 6, slots.travel_days - 1, cities.length, 6)

  const results = []
  // 按城市数分桶记最优 effCost：防止"便宜的少城线"把多城方案全部剪掉
  const bestByCount = {}
  const KEEP = 60 // 结果池上限

  function recordSolution(visited, legs, cost) {
    // 必去城市硬门槛：未走完全部必去城市的中途状态不算合格方案
    if (slots.must_visit.length > 0 && !slots.must_visit.every(m => visited.includes(m))) return
    const lastCity = cities.find(c => c.iata === visited[visited.length - 1])
    const retDate = addDays(legs[legs.length - 1].date, 1)
    const ret = bestLeg(lastCity, origin, retDate)
    const totalLegs = [...legs, ret]
    const totalPrice = cost + ret.price
    const nightsSaved = totalLegs.filter(isNightLeg).length
    const effCost = totalPrice - nightsSaved * (slots.overnight_pref ? lodging : 0)
    const count = visited.length
    // 含真实报价的方案不参与估算价的桶比较（真实数据优先，防止被估算价剪掉）
    const hasReal = totalLegs.some(l => l.real === true)
    if (!hasReal) {
      if (bestByCount[count] != null && effCost >= bestByCount[count] && results.length >= KEEP) return
      if (bestByCount[count] == null || effCost < bestByCount[count]) bestByCount[count] = effCost
    }
    results.push({
      cities: [...visited],
      citySeq: [slots.origin, ...visited, slots.origin],
      legs: totalLegs,
      totalPrice,
      effCost,
      nightsSaved,
      hasReal: totalLegs.some(l => l.real === true) // 含真实报价段
    })
    if (results.length > KEEP * 2) {
      results.sort((a, b) => a.effCost - b.effCost)
      // 截断时保护含真实报价的方案（真实数据优先于估算价排序）
      const realOnes = results.filter(r => r.hasReal)
      const mockOnes = results.filter(r => !r.hasReal).slice(0, Math.max(0, KEEP - realOnes.length))
      results.length = 0
      results.push(...realOnes, ...mockOnes)
    }
  }

  // 深度优先。状态：(当前城市, 当前日期, 已用晚数, 已访问序列, 累计段, 累计成本)
  function dfs(curCity, curDate, nightsUsed, visited, legs, cost) {
    if (visited.length >= 2) recordSolution(visited, legs, cost)
    if (visited.length >= maxCities) return
    // 剩余晚数不够再玩一城（至少 1 晚）就收尾
    if (nightsUsed + 1 > slots.travel_days - 1) return

    for (const next of cities) {
      if (visited.includes(next.iata)) continue
      // 剩余必去城市数（不含候选 next）
      const mustLeft = slots.must_visit.filter(m => !visited.includes(m) && m !== next.iata).length
      const isMust = slots.must_visit.includes(next.iata)

      for (const stay of stayOptions) {
        if (nightsUsed + stay > slots.travel_days - 1) continue
        // 必去城市保障：加入 next 后剩余晚数必须够走完全部必去城市（每城至少 1 晚）
        if (slots.must_visit.length > 0 && !isMust) {
          if (nightsUsed + stay + mustLeft > slots.travel_days - 1) continue
        }
        const depDate = addDays(curDate, stay)
        if (depDate > slots.window_to) continue
        const leg = bestLeg(curCity, next, depDate)
        const newCost = cost + leg.price
        // 预算硬约束剪枝
        if (slots.budget_max && newCost > slots.budget_max) continue
        // 分桶软剪枝：目标城市数下已明显更差则放弃（放宽 15% 容忍度）
        // 含真实报价段的分支豁免：估算价桶无权剪掉真实数据
        const targetCount = visited.length + 1
        const hasRealSoFar = leg.real === true || legs.some(l => l.real === true)
        if (!hasRealSoFar && bestByCount[targetCount] != null && newCost > bestByCount[targetCount] * 1.15) continue

        dfs(next, depDate, nightsUsed + stay, [...visited, next.iata], [...legs, leg], newCost)
      }
    }
  }

  // 入口段：出发地 → 各候选入口城市（出发日取窗口内前几个采样日）
  const entryDates = []
  for (const off of [0, 2, 5]) {
    const d = addDays(slots.window_from, off)
    if (d <= slots.window_to && !entryDates.includes(d)) entryDates.push(d)
  }
  for (const entry of cities) {
    for (const depDate of entryDates) {
      const leg = bestLeg(origin, entry, depDate)
      if (slots.budget_max && leg.price > slots.budget_max) continue
      dfs(entry, depDate, 0, [entry.iata], [leg], leg.price)
    }
  }

  results.sort((a, b) => a.effCost - b.effCost)
  // 含真实报价的方案置顶（估算价排序可能低估未探测航段）
  results.sort((a, b) => Number(b.hasReal) - Number(a.hasReal))
  return results.slice(0, KEEP)
}

/**
 * 收敛成差异化候选路线：总价最低（≥4城优先，贴合"尽可能多城市"诉求）/ 城市最多 / 夜航最省住宿（去重，最多 3 条）
 */
function convergeRoutes(routes) {
  if (routes.length === 0) return []
  const picked = []
  const seen = new Set()
  const keyOf = r => r.cities.join('>')

  // 主推：≥4 城里最便宜；城市都不足 4 个则退化为全局最便宜
  const cheapest =
    routes.find(r => r.cities.length >= 4) || routes[0] // routes 已按 effCost 升序
  picked.push({ kind: 'cheapest', route: cheapest })
  seen.add(keyOf(cheapest))

  const mostCities = [...routes]
    .sort((a, b) => b.cities.length - a.cities.length || a.effCost - b.effCost)
    .find(r => !seen.has(keyOf(r)))
  if (mostCities) {
    picked.push({ kind: 'mostCities', route: mostCities })
    seen.add(keyOf(mostCities))
  }

  const mostNights = [...routes]
    .filter(r => r.nightsSaved > 0)
    .sort((a, b) => b.nightsSaved - a.nightsSaved || a.effCost - b.effCost)
    .find(r => !seen.has(keyOf(r)))
  if (mostNights) picked.push({ kind: 'mostNights', route: mostNights })

  return picked
}

module.exports = {
  SCHENGEN_CITIES,
  VISA_FREE_CITIES,
  ORIGINS,
  parseDirective,
  validateSlots,
  mockLegs,
  selectPool,
  searchRoutes,
  convergeRoutes,
  isNightLeg,
  LODGING_CNY
}
