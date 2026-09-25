import { z } from 'zod'
import { createUserMessage, expandAssistantStream } from '@deepseek-ai/dsh-llm'
import { createRuntime, PROFILE, CORE_PLUGINS } from './runtime.mjs'

const id = z.string().min(1).max(160)
const envelope = z.object({ id, op: z.enum(['open', 'turn', 'cancel', 'close', 'tool_result']), data: z.unknown() }).strict()
const turnSchema = z.object({ generation: id, message: z.string().min(1).max(2000), snapshot: z.string().max(100000) }).strict()
const pending = new Map()
let ctx, handle, active, opening = false
let serial = 0
const send = message => {
  if (Buffer.byteLength(JSON.stringify(message)) > 1_000_000) throw new Error('DSH_IPC_TOO_LARGE')
  if (process.connected) process.send(message)
}
async function bridge(name, args, exec) {
  if (!active || active.cancelled) throw new Error('DSH_GENERATION_RETIRED')
  const callId = `${active.generation}:${++serial}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(callId); reject(new Error('DSH_TOOL_TIMEOUT')) }, 120_000)
    const abort = () => { clearTimeout(timer); pending.delete(callId); reject(new Error('DSH_TOOL_CANCELLED')) }
    exec.signal?.addEventListener('abort', abort, { once: true })
    pending.set(callId, { resolve: value => { clearTimeout(timer); exec.signal?.removeEventListener('abort', abort); resolve(value) }, reject })
    send({ kind: 'tool', id: callId, generation: active.generation, name, args })
  })
}
async function open(data) {
  if (ctx || opening) throw new Error('DSH_ALREADY_OPEN')
  opening = true
  const config = z.object({ root: z.string().min(1), sessionId: id, resume: z.boolean(), persona: z.string().max(50000),
    tools: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), description: z.string(), rawSchema: z.record(z.string(), z.unknown()) }).strict()).max(32),
    route: z.object({ provider: z.enum(['openrouter', 'deepseek', 'fixture']), model: z.string().min(1), baseURL: z.url().optional(), maxTokens: z.number().int().min(256).max(16384).default(4096) }).strict(),
    fixture: z.array(z.unknown()).optional(),
    web: z.object({ provider: z.enum(['serpapi-raw', 'deepseek-official']), baseURL: z.url().optional(), model: z.string().optional() }).strict().optional(),
    metered: z.boolean().optional(),
  }).strict().parse(data)
  let adapter
  if (config.route.provider === 'fixture') {
    if (process.env.FLIGHTOR_DSH_TEST !== '1') throw new Error('DSH_FIXTURE_DISABLED')
    const { FixtureAdapter } = await import('./test/fixture-adapter.mjs')
    adapter = new FixtureAdapter(config.fixture ?? [])
  }
  ctx = await createRuntime({ ...config, adapter, provider: config.route.provider, execute: bridge })
  ctx.on('tools/execute', async (exec, next) => {
    if (!active || !['web_search', 'web_fetch'].includes(exec.name)) return next()
    const toolCallId = `${active.generation}:web:${++serial}`
    send({ kind: 'activity', generation: active.generation, type: 'tool_start', toolName: exec.name, toolCallId })
    try { return await next() }
    finally { send({ kind: 'activity', generation: active?.generation, type: 'tool_end', toolName: exec.name, toolCallId }) }
  })
  if (!adapter) {
    const llm = await import('@deepseek-ai/dsh-llm-pi-ai')
    await ctx.plugin(llm, { providers: { [config.route.provider]: {
      apiKeyEnv: 'FLIGHTOR_DSH_MODEL_KEY', api: 'openai-completions', baseURL: config.route.baseURL,
      models: [{ id: config.route.model, contextWindow: 131072, maxTokens: config.route.maxTokens,
        reasoningEfforts: config.route.provider === 'deepseek' ? { off: null, high: 'high' } : false }],
      ...(config.route.provider === 'deepseek' ? { reasoning: 'off', compat: { thinkingFormat: 'deepseek' } } : {}),
      retryPolicy: { mode: 'normal', maxRetries: 0 }, defaultMaxTokens: config.route.maxTokens, timeoutMs: 60000,
    } } })
  }
  ctx.on('llm/stream', async function* (options, next) {
    if (!active || active.cancelled || active.calls >= 12) throw new Error('DSH_MODEL_LIMIT')
    const started = performance.now()
    const billingId = `${active.generation}:model:${active.calls + 1}`
    if (config.metered) {
      const receipt = await bridge('__model_admit', { id: billingId }, { signal: options.signal })
      if (!receipt?.ok) throw new Error('DSH_BUDGET_NOT_ADMITTED')
    }
    active.calls += 1
    send({ kind: 'activity', generation: active.generation, type: 'model_start' })
    let usage, finishReason, failed = false
    try { for await (const chunk of next()) {
      if (chunk.type === 'usage') usage = chunk.usage
      if (chunk.type === 'finish') { finishReason = chunk.reason.kind; failed = ['error', 'aborted'].includes(finishReason) }
      yield chunk
    } }
    catch (error) { failed = true; throw error } finally {
      if (config.metered && active && !active.cancelled) await bridge('__model_receipt', { id: billingId,
        durationMs: performance.now() - started, usage: usage ?? null, failed,
        ...(finishReason ? { finishReason } : {}), model: config.route.model, maxTokens: config.route.maxTokens,
        ...(config.route.provider === 'deepseek' ? { thinking: 'disabled' } : {}) }, {})
      send({ kind: 'activity', generation: active?.generation, type: 'model_end', durationMs: performance.now() - started })
    }
  })
  const agentOptions = { provider: config.route.provider, model: config.route.model, maxTokens: config.route.maxTokens }
  handle = config.resume ? await ctx.agents.resume({ resumeSessionId: config.sessionId, agentOptions })
    : await ctx.agents.create({ sessionId: config.sessionId, agentOptions })
  // No unfinished inbox is replayed after process recovery.
  if (config.resume) await handle.agent.cancel({ kind: 'user' })
  return { profile: PROFILE, plugins: [...CORE_PLUGINS, ...(!adapter ? ['llm-pi-ai'] : []), ...(config.web ? ['web', 'tool-web', ...(config.web.provider === 'deepseek-official' ? ['web-search-deepseek'] : [])] : [])], tools: ctx.tools.schemas().map(tool => tool.name), sessionId: config.sessionId, resumed: config.resume }
}
async function turn(data) {
  if (!handle) throw new Error('DSH_NOT_OPEN')
  if (active) throw new Error('DSH_TURN_BUSY')
  const input = turnSchema.parse(data)
  active = { generation: input.generation, cancelled: false, calls: 0 }
  const start = handle.agent.session.snapshotEvents().length
  try {
    handle.agent.inject(createUserMessage({ content: [{ type: 'text', text: input.snapshot }], source: { kind: 'flightor-context' } }))
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: input.message }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    const events = handle.agent.session.snapshotEvents().slice(start)
    const end = events.findLast(event => event.type === 'turn/end')
    const message = events.findLast(event => event.type === 'assistant/message')
    const text = message ? expandAssistantStream(message.data.stream).flatMap(({ chunk }) => chunk.type === 'block-end' && chunk.block.type === 'text' ? [chunk.block.text] : []).join('\n') : ''
    return { reply: text, reason: end?.data.reason.kind ?? 'failed', calls: active.calls, cancelled: active.cancelled }
  } finally { active = undefined }
}
process.on('message', async raw => {
  let message
  try {
    if (Buffer.byteLength(JSON.stringify(raw)) > 1_000_000) throw new Error('DSH_IPC_TOO_LARGE')
    message = envelope.parse(raw)
    if (message.op === 'tool_result') {
      const value = pending.get(message.id)
      pending.delete(message.id)
      value?.resolve(message.data)
      return
    }
    let result
    if (message.op === 'open') result = await open(message.data)
    if (message.op === 'turn') result = await turn(message.data)
    if (message.op === 'cancel') {
      const generation = z.object({ generation: id }).strict().parse(message.data).generation
      if (active?.generation === generation) { active.cancelled = true; await handle.agent.cancel({ kind: 'user' }); await handle.agent.whenIdle() }
      result = { cancelled: true }
    }
    if (message.op === 'close') { if (active) active.cancelled = true; await handle?.dispose(); await ctx?.fiber.dispose(); result = { closed: true } }
    send({ kind: 'result', id: message.id, ok: true, data: result })
    if (message.op === 'close') process.disconnect()
  } catch (error) {
    send({ kind: 'result', id: message?.id ?? 'invalid', ok: false, error: String(error?.message ?? 'DSH_WORKER_FAILURE').slice(0, 500) })
  }
})
process.on('disconnect', () => { process.exit(0) })
