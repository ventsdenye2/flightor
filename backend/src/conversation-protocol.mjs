import fs from 'node:fs'
import crypto from 'node:crypto'
import { replaceFileSync } from './file-replace.mjs'

export const submissionTool = 'submit_conversation_reply'
export const repairLimitMs = 30000
export const roleEfforts = Object.freeze({ conversation: 'low', planner: 'high', reviewer: 'high' })

export function reasoningEffortFor(role, env = process.env) {
  if (role !== 'planner') return roleEfforts[role]
  const value = env.FLIGHTOR_DSH_PLANNER_REASONING_EFFORT || roleEfforts.planner
  if (!['low', 'high', 'max'].includes(value)) throw Error('FLIGHTOR_DSH_PLANNER_REASONING_EFFORT 必须为 low、high 或 max')
  return value
}

export class OutputProtocolError extends Error {
  constructor(detail, metrics) {
    super('本次回复未能正确提交，请重试一次。')
    this.code = 'OUTPUT_PROTOCOL_ERROR'
    this.detail = detail
    this.protocolMetrics = metrics
  }
}

export function replyErrors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['提交参数必须是对象']
  const errors = []
  if (typeof value.reply !== 'string' || !value.reply.trim()) errors.push('reply 必须是非空字符串')
  if (!Object.hasOwn(value, 'intent')) errors.push('缺少必填字段 intent，必须显式填写 chat 或 plan')
  else if (!['chat', 'plan'].includes(value.intent)) errors.push('intent 必须是 chat 或 plan')
  for (const key of Object.keys(value)) if (!['reply', 'intent'].includes(key)) errors.push(`未知字段 ${key}`)
  return errors
}

export function validateConversationReply(value) {
  const errors = replyErrors(value)
  if (errors.length) throw new OutputProtocolError(errors.join('；'))
  return { reply: value.reply.trim(), intent: value.intent }
}

// One private file per DSH child. Synchronous guard updates precede tool dispatch;
// the parent only updates at idle, cancellation, or an unhandled native args error.
export class ConversationSubmission {
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
    if (exec.name !== submissionTool) return state.phase === 'repair' ? `当前仅允许 ${submissionTool} 补正结果；禁止查票、搜索、规划或其他工具。` : undefined
    const errors = replyErrors(exec.arguments)
    const same = !errors.length && state.accepted && JSON.stringify(validateConversationReply(exec.arguments)) === JSON.stringify(state.accepted)
    if (!state.handledCalls.includes(exec.callId)) {
      state.handledCalls.push(exec.callId)
      if (!same) state.attempts++
    }
    if (errors.length) {
      this.repair(errors.join('；'), state)
      return `${errors.join('；')}。只调用 ${submissionTool} 补正一次，不调用其他工具。`
    }
    if (state.accepted && !same) {
      state.failed = true; state.errors.push('不同结果重复提交，协议冲突'); this.write(state)
      return '不同结果重复提交，协议冲突。'
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
    const reply = validateConversationReply(args)
    if (state.accepted && JSON.stringify(state.accepted) !== JSON.stringify(reply)) {
      state.failed = true; this.write(state); throw new OutputProtocolError('不同结果重复提交')
    }
    state.accepted = reply
    this.write(state)
    return { requestId: state.requestId, ...reply }
  }
  close() { const state = this.read(); state.phase = 'closed'; this.write(state) }
  metrics() {
    const state = this.read()
    return { requestId: state.requestId, attempts: state.attempts, repairCount: Number(state.repairStartedAt !== null), repairStartedAt: state.repairStartedAt, firstSubmissionSucceeded: !!state.accepted && !state.failed && state.repairStartedAt === null, errors: state.errors }
  }
}

export function submittedReply(events, requestId) {
  const calls = new Map()
  let answer
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.name === submissionTool) calls.set(event.data.callId, event.data)
    if (event.type !== 'tool/result') continue
    const message = event.data.message
    if (!calls.has(message?.toolCallId) || message.isError || event.data.error) continue
    let value
    try { value = JSON.parse(message.content.filter(block => block.type === 'text').map(block => block.text).join('')) } catch { throw new OutputProtocolError('成功工具结果无法读取') }
    if (value.requestId !== requestId) continue
    const candidate = validateConversationReply({ reply: value.reply, intent: value.intent })
    if (answer && JSON.stringify(answer) !== JSON.stringify(candidate)) throw new OutputProtocolError('不同结果重复提交')
    answer = candidate
  }
  return answer
}
