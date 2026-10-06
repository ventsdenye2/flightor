import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Reuses the D4 runtime guard policy against the selected build, without
 * recording credentials, user prose, source bodies, or model reasoning. */
export async function installD6RuntimeGuards({ runtimeDir, auditPath }) {
  if (!path.isAbsolute(runtimeDir) || !path.isAbsolute(auditPath)) throw Error('D6_GUARD_ABSOLUTE_PATHS_REQUIRED')
  fs.mkdirSync(path.dirname(auditPath), { recursive: true, mode: 0o700 })
  // Cold resume keeps this audit: each installation appends its own session.
  const descriptor = fs.openSync(auditPath, 'a', 0o600)
  const guardSessionId = randomUUID()
  const localization = new AsyncLocalStorage()
  const restore = []
  let forbiddenCalls = 0, closed = false
  const record = event => fs.writeSync(descriptor, `${JSON.stringify({ ...event, guardSessionId, pid: process.pid, at: new Date().toISOString() })}\n`)
  const forbidden = name => {
    forbiddenCalls++
    record({ type: 'forbidden', name })
    throw Error(`D6_FORBIDDEN_${name}`)
  }
  const replace = (prototype, method, wrapped) => {
    const original = prototype[method]
    prototype[method] = wrapped
    restore.push(() => { if (prototype[method] === wrapped) prototype[method] = original })
  }
  const load = relative => import(pathToFileURL(path.join(runtimeDir, `${relative}.js`)).href)
  try {
    for (const [file, className, method] of [
      ['agent/cloud/service', 'CloudPlannerService', 'runTurn'],
      ['agent/runtime/runtime', 'AgentRuntime', 'run'],
      ['research-agent/production', 'ProductionResearchAgent', 'research'],
      ['research-agent/native', 'NativeResearchAgent', 'research'],
      ['providers/openrouter/research', 'OpenRouterResearchSynthesisModel', 'synthesize']
    ]) {
      const prototype = (await load(file))[className]?.prototype
      if (!prototype || typeof prototype[method] !== 'function') throw Error('D6_GUARD_TARGET_MISSING')
      replace(prototype, method, async () => forbidden(`${className}_${method}`))
    }
    const prototype = (await load('travel-guides/finalization')).GuideFinalizer?.prototype
    if (!prototype || typeof prototype.generate !== 'function') throw Error('D6_GUARD_TARGET_MISSING')
    const generate = prototype.generate
    replace(prototype, 'generate', function (...args) {
      if (!localization.getStore()) return forbidden('initial_finalizer')
      return generate.apply(this, args)
    })
    record({ type: 'guards_installed', engine: 'dsh', runtimeDir,
      guarded: ['CloudPlannerService.runTurn', 'AgentRuntime.run', 'ProductionResearchAgent.research',
        'NativeResearchAgent.research', 'OpenRouterResearchSynthesisModel.synthesize',
        'GuideFinalizer.generate outside explicit localization'] })
  } catch (error) {
    for (const undo of restore.reverse()) undo()
    fs.closeSync(descriptor)
    throw error
  }
  return {
    auditPath,
    get forbiddenCalls() { return forbiddenCalls },
    installHttpHooks(app) {
      app.addHook('onRequest', (request, _reply, done) => {
        const requestPath = request.url.split('?')[0]
        record({ type: 'http', method: request.method, path: requestPath })
        const allowed = request.method === 'POST' && /^\/v1\/artifacts\/[0-9a-f-]{36}\/localization$/i.test(requestPath)
        localization.run(allowed, done)
      })
      app.addHook('onResponse', async (request, reply) => {
        record({ type: 'http_response', method: request.method, path: request.url.split('?')[0], statusCode: reply.statusCode })
      })
    },
    close() {
      if (closed) return
      closed = true
      for (const undo of restore.reverse()) undo()
      try { record({ type: 'guards_closed', forbiddenCalls }); fs.fsyncSync(descriptor) }
      finally { fs.closeSync(descriptor) }
    }
  }
}
