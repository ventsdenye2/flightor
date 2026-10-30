import fs from 'node:fs'
import crypto from 'node:crypto'
import { replaceFileSync } from './file-replace.mjs'
import { OutputProtocolError, repairLimitMs } from './conversation-protocol.mjs'

export const itinerarySubmissionTool = 'submit_itinerary'

const nullableString = { oneOf: [{ type: 'string' }, { type: 'null' }] }
const nullableNumber = { oneOf: [{ type: 'number' }, { type: 'null' }] }
const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { label: { type: 'string', required: true }, url: { type: 'string', required: true } }
}
const activitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: '稳定活动ID，必须与 lookup_places_batch 使用的ID一致' },
    name: { type: 'string', required: true },
    description: { type: 'string', required: true },
    introduction: { type: 'string' },
    recommendationReason: { type: 'string' },
    visitNotes: { type: 'string' },
    imageQuery: nullableString,
    city: { type: 'string' },
    time: nullableString,
    until: nullableString,
    category: { type: 'string' },
    latitude: nullableNumber,
    longitude: nullableNumber,
    sources: { type: 'array', items: sourceSchema }
  }
}
const daySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    day: { type: 'integer' },
    date: nullableString,
    theme: { type: 'string' },
    activities: { type: 'array', required: true, items: activitySchema }
  }
}
const highlightSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { title: { type: 'string', required: true }, description: { type: 'string', required: true } }
}
const issueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { detail: { type: 'string', required: true } }
}
const flightSelectionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { searchId: { type: 'string', required: true }, candidateId: { type: 'string', required: true } }
}

export const itinerarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', required: true },
    destination: { type: 'string', required: true },
    overview: { type: 'string', required: true },
    highlights: { type: 'array', required: true, items: highlightSchema },
    startDate: nullableString,
    endDate: nullableString,
    travelers: { type: 'integer' },
    days: { type: 'array', required: true, items: daySchema },
    flightSelection: { oneOf: [flightSelectionSchema, { type: 'null' }] },
    issues: { type: 'array', required: true, items: issueSchema }
  }
}

const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && !!value.trim()

export function itineraryErrors(value) {
  if (!record(value)) return ['itinerary 必须是对象']
  const errors = []
  for (const key of ['title', 'destination', 'overview']) if (!text(value[key])) errors.push(`${key} 必须是非空字符串`)
  for (const key of ['highlights', 'days', 'issues']) if (!Array.isArray(value[key])) errors.push(`${key} 必须是数组`)
  if (value.travelers !== undefined && (!Number.isInteger(value.travelers) || value.travelers < 1)) errors.push('travelers 必须是正整数')
  if (Array.isArray(value.days)) {
    value.days.forEach((day, dayIndex) => {
      if (!record(day)) { errors.push(`days[${dayIndex}] 必须是对象`); return }
      if (!Array.isArray(day.activities)) errors.push(`days[${dayIndex}].activities 必须是数组`)
      if (!Array.isArray(day.activities)) return
      day.activities.forEach((activity, activityIndex) => {
        if (!record(activity)) errors.push(`days[${dayIndex}].activities[${activityIndex}] 必须是对象`)
        else if (!text(activity.id) || !text(activity.name) || typeof activity.description !== 'string') errors.push(`days[${dayIndex}].activities[${activityIndex}] 缺少 id、name 或 description`)
      })
    })
  }
  return errors
}

export function validateItinerary(value) {
  const errors = itineraryErrors(value)
  if (errors.length) throw new OutputProtocolError(errors.join('；'))
  return value
}

// State lives in one private file per reviewer child so the child guard and
// parent result reader share a single execution boundary.
export class ItinerarySubmission {
  constructor(file, { now = Date.now } = {}) { this.file = file; this.now = now }
  read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')) }
  write(state) {
    const temporary = this.file + '.' + crypto.randomUUID() + '.tmp'
    fs.writeFileSync(temporary, JSON.stringify(state))
    replaceFileSync(temporary, this.file)
    return state
  }
  reset() {
    return this.write({ requestId: crypto.randomUUID(), phase: 'normal', attempts: 0, handledCalls: [], repairStartedAt: null, errors: [], accepted: null, failed: false })
  }
  repair(detail, state = this.read()) {
    if (state.repairStartedAt !== null || state.accepted) state.failed = true
    else { state.phase = 'repair'; state.repairStartedAt = this.now(); state.attempts = Math.max(1, state.attempts) }
    state.errors.push(detail)
    return this.write(state)
  }
  nativeFailure(callId, detail) {
    const state = this.read()
    if (state.handledCalls.includes(callId) || state.phase === 'closed') return state
    state.handledCalls.push(callId)
    state.attempts++
    return this.repair(detail, state)
  }
  guard(exec) {
    const state = this.read()
    if (state.phase === 'closed' || exec.signal?.aborted) return '本次提交已取消或结束，禁止迟到提交。'
    if (state.failed) return '提交协议失败，唯一补正机会已用完。'
    if (state.repairStartedAt !== null && this.now() - state.repairStartedAt >= repairLimitMs) {
      state.failed = true; this.write(state)
      return '提交补正已超过30秒。'
    }
    if (exec.name !== itinerarySubmissionTool) {
      if (state.phase === 'repair') return `当前仅允许 ${itinerarySubmissionTool} 补正结果；禁止重新查询、搜索或启动其他工具。`
      if (state.accepted) return '行程已成功提交，请结束本轮，不再调用其他工具。'
      return undefined
    }
    const errors = itineraryErrors(exec.arguments?.itinerary)
    const same = !errors.length && state.accepted && JSON.stringify(validateItinerary(exec.arguments.itinerary)) === JSON.stringify(state.accepted)
    if (!state.handledCalls.includes(exec.callId)) {
      state.handledCalls.push(exec.callId)
      if (!same) state.attempts++
    }
    if (errors.length) {
      this.repair(errors.join('；'), state)
      return `${errors.join('；')}。只调用 ${itinerarySubmissionTool} 补正一次，不调用其他工具。`
    }
    if (state.accepted && !same) {
      state.failed = true; state.errors.push('不同行程重复提交，协议冲突'); this.write(state)
      return '不同行程重复提交，协议冲突。'
    }
    if (state.attempts > 2) {
      state.failed = true; this.write(state)
      return '提交次数超过首次交付加一次补正。'
    }
    this.write(state)
  }
  submit(args, exec) {
    exec.signal?.throwIfAborted()
    const state = this.read()
    if (state.phase === 'closed' || state.failed || (state.repairStartedAt !== null && this.now() - state.repairStartedAt >= repairLimitMs)) throw new OutputProtocolError('提交已关闭或补正超时')
    const itinerary = validateItinerary(args?.itinerary)
    if (state.accepted && JSON.stringify(state.accepted) !== JSON.stringify(itinerary)) {
      state.failed = true; this.write(state); throw new OutputProtocolError('不同行程重复提交')
    }
    state.accepted = itinerary
    this.write(state)
    return { requestId: state.requestId, accepted: true, days: itinerary.days.length, activities: itinerary.days.reduce((total, day) => total + day.activities.length, 0) }
  }
  close() { const state = this.read(); state.phase = 'closed'; this.write(state) }
  metrics() {
    const state = this.read()
    return { requestId: state.requestId, attempts: state.attempts, repairCount: Number(state.repairStartedAt !== null), repairStartedAt: state.repairStartedAt, firstSubmissionSucceeded: !!state.accepted && !state.failed && state.repairStartedAt === null, errors: state.errors }
  }
}

function parseArguments(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { throw new OutputProtocolError('成功提交参数无法读取') }
}

export function submittedItinerary(events, requestId) {
  const calls = new Map()
  let answer
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.name === itinerarySubmissionTool) calls.set(event.data.callId, event.data.arguments)
    if (event.type !== 'tool/result') continue
    const message = event.data.message
    if (!calls.has(message?.toolCallId) || message.isError || event.data.error) continue
    let value
    try { value = JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('')) } catch { throw new OutputProtocolError('成功工具结果无法读取') }
    if (value.requestId !== requestId) continue
    const args = parseArguments(calls.get(message.toolCallId))
    const candidate = validateItinerary(args?.itinerary)
    if (answer && JSON.stringify(answer) !== JSON.stringify(candidate)) throw new OutputProtocolError('不同行程重复提交')
    answer = candidate
  }
  return answer
}
