import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const installation = Symbol.for('flightor.dsh.e2e.observation')
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value) ? value : undefined
const toolName = value => typeof value === 'string' && /^_{0,2}[a-z][a-z0-9_]{0,63}$/.test(value) ? value : undefined
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value) ? value : undefined
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : undefined
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const code = value => typeof value === 'string' ? value.match(/^[A-Za-z][A-Za-z0-9_-]{0,99}(?=$|[:\s])/u)?.[0] : undefined
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
const array = value => Array.isArray(value) ? value : []
const reference = value => uuid(value) ?? hash(value)
function safeUrl(value) {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined
    // Query strings/fragments can contain signed access tokens or private search text.
    url.search = ''; url.hash = ''
    return url.href.length <= 1000 ? url.href : undefined
  } catch { return undefined }
}
function revisionReasons(value) {
  const data = object(value), error = object(data.error), details = object(error.details)
  const candidates = [...array(data.issues), ...array(details.issues), ...array(object(details.repair).issues)]
  return [...new Set(candidates.map(issue => code(typeof issue === 'string' ? issue : object(issue).code)).filter(Boolean))].slice(0, 100)
}
function commitInput(value) {
  const args = object(value)
  return { baseGuideId: uuid(args.baseGuideId), expectedContentHash: hash(args.expectedContentHash),
    replaceSlots: array(args.replaceSlots).slice(0, 100).flatMap(value => {
      const slot = object(value)
      return Number.isInteger(slot.day) && slot.day > 0 && slot.day <= 365 && ['morning', 'afternoon', 'evening', 'flexible'].includes(slot.slot)
        ? [{ day: slot.day, slot: slot.slot }] : []
    }) }
}
function meterInput(value) {
  const args = object(value), usage = object(args.usage)
  return { id: identifier(args.id), durationMs: number(args.durationMs), failed: typeof args.failed === 'boolean' ? args.failed : undefined,
    finishReason: code(args.finishReason), model: typeof args.model === 'string' && /^[A-Za-z0-9_./:-]{1,200}$/.test(args.model) ? args.model : undefined, maxTokens: number(args.maxTokens),
    thinking: args.thinking === 'disabled' ? 'disabled' : undefined,
    usage: Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
      .filter(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0).map(key => [key, usage[key]])) }
}
function toolOutput(name, args, value) {
  const result = object(value), error = object(result.error)
  const base = { ok: typeof result.ok === 'boolean' ? result.ok : undefined, errorCode: code(error.code) }
  if (name === 'commit_travel_guide') return { ...base, status: code(result.status), artifactId: uuid(object(result.artifact).id),
    guideContentHash: hash(result.guideContentHash), deliveryStatus: code(object(result.completion).status), revisionReasons: revisionReasons(result) }
  if (name === '__record_web') return { ...base, webTool: ['web_search', 'web_fetch'].includes(object(args).tool) ? args.tool : undefined,
    evidenceRefs: array(result.evidenceRefs).map(reference).filter(Boolean).slice(0, 100),
    urls: array(result.urls).map(safeUrl).filter(Boolean).slice(0, 100) }
  if (name === '__web_search') return { ...base, urls: array(result.sources).map(source => safeUrl(object(source).url)).filter(Boolean).slice(0, 100) }
  if (name === '__web_fetch') return { ...base, url: safeUrl(result.url), statusCode: number(result.statusCode) }
  return base
}

/** Install once after the runner's dry-run exit. Never records prompt, reply, page body, key or model reasoning text. */
export async function installDshE2eObservation({ directory, dataDirectory }) {
  if (!path.isAbsolute(directory) || !path.isAbsolute(dataDirectory)) throw Error('DSH_OBSERVATION_ABSOLUTE_PATHS_REQUIRED')
  const output = path.join(path.resolve(directory), 'executions')
  const sessionRoot = path.resolve(dataDirectory)
  const { DshSessionManager } = await import('../dist/agent/dsh/session-manager.js')
  const prototype = DshSessionManager.prototype
  if (prototype[installation]) {
    if (prototype[installation].directory !== output || prototype[installation].dataDirectory !== sessionRoot) throw Error('DSH_OBSERVATION_ALREADY_INSTALLED')
    return prototype[installation]
  }
  fs.mkdirSync(output, { recursive: true, mode: 0o700 })
  const original = prototype.run
  const status = { directory: output, dataDirectory: sessionRoot, writeFailures: 0,
    uninstall() { if (prototype.run === wrapped) prototype.run = original; delete prototype[installation] } }
  async function wrapped(input) {
    const executionId = randomUUID(), started = performance.now()
    const file = path.join(output, `${executionId}.jsonl`)
    // Failure to open the audit file occurs before any new paid run starts.
    const descriptor = fs.openSync(file, 'ax', 0o600)
    const scope = { executionId, generationId: identifier(input.generationId), tripId: identifier(input.tripId), conversationId: identifier(input.conversationId) }
    let sequence = 0
    const append = (type, data = {}) => {
      try { fs.writeSync(descriptor, `${JSON.stringify({ ...scope, sequence: ++sequence, at: new Date().toISOString(), elapsedMs: performance.now() - started, type, ...data })}\n`) }
      catch { status.writeFailures++ } // Observation must not replace the original return value or exception.
    }
    append('execution_start')
    try {
      const result = await original.call(this, { ...input,
        onActivity(activity) {
          append('activity', { activity: code(activity.type), toolName: toolName(activity.toolName), toolCallId: identifier(activity.toolCallId), durationMs: number(activity.durationMs) })
          return input.onActivity?.(activity)
        },
        async execute(name, args, callId, signal) {
          const began = performance.now()
          const common = { toolName: toolName(name), toolCallId: identifier(callId) }
          const meter = ['__model_admit', '__model_receipt', '__search_admit', '__search_receipt'].includes(name)
          append('tool_start', { ...common, ...(name === 'commit_travel_guide' ? { commit: commitInput(args) } : {}), ...(meter ? { meter: meterInput(args) } : {}) })
          try {
            const result = await input.execute(name, args, callId, signal)
            append('tool_end', { ...common, durationMs: performance.now() - began, ...toolOutput(name, args, result) })
            return result
          } catch (error) {
            append('tool_error', { ...common, durationMs: performance.now() - began, errorCode: code(error?.code) ?? 'UNCLASSIFIED_TOOL_ERROR',
              ...(name === 'commit_travel_guide' ? { revisionReasons: revisionReasons({ error }) } : {}) })
            throw error
          }
        },
      })
      append('execution_result', { reason: code(result.reason), calls: number(result.calls), resumed: result.resumed === true,
        rehydrated: result.rehydrated === true, cancelled: result.cancelled === true })
      return result
    } catch (error) {
      append('execution_error', { errorCode: code(error?.code) ?? 'UNCLASSIFIED_EXECUTION_ERROR' })
      throw error
    } finally {
      try {
        const key = createHash('sha256').update(JSON.stringify([input.ownerId, input.tripId, input.conversationId])).digest('hex')
        const mapping = JSON.parse(fs.readFileSync(path.join(sessionRoot, `${key}.json`), 'utf8'))
        append('session_mapping', { sessionId: uuid(mapping.sessionId), profile: hash(mapping.profile), epochHash: hash(mapping.epochHash) })
      } catch { append('session_mapping_unavailable') }
      append('execution_closed')
      try { fs.fsyncSync(descriptor) } catch { status.writeFailures++ }
      try { fs.closeSync(descriptor) } catch { status.writeFailures++ }
    }
  }
  prototype.run = wrapped
  prototype[installation] = status
  return status
}
