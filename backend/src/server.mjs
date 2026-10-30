import http from 'node:http'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { dataRoot } from './paths.mjs'
import { replaceFile } from './file-replace.mjs'
import { runPlan } from './plan.mjs'
import { loadConversation, runConversation, selectConversationFlight } from './conversation.mjs'
import { resolveFlightSelection } from './flight-options.mjs'
import { loadPlaceMedia } from './place-media.mjs'
import { loadPlaceLocation } from './place-locations.mjs'
import { manualFlightQuery, runManualFlightSearch } from './manual-flight-search.mjs'
import { searchFlightLocations } from './flight-locations.mjs'
import { runFlightDetails } from './flight-details.mjs'
import { loadTripContext } from './trip-context.mjs'
import { listTrips, archiveTrip } from './trip-library.mjs'
import { resolveTripContext } from './conversation-timeline.mjs'
import {storedTripCover} from './trip-cover.mjs'
import { startFlightWorker } from '../../trip-flight-tool/dist/worker.js'

const flightWorker = process.env.FLIGHTOR_FLIGHT_WORKER === '0' ? null : await startFlightWorker()
if (flightWorker) {
  process.env.TRIP_FLIGHT_WORKER_URL = flightWorker.url
  process.env.TRIP_FLIGHT_WORKER_TOKEN = flightWorker.token
} else {
  delete process.env.TRIP_FLIGHT_WORKER_URL
  delete process.env.TRIP_FLIGHT_WORKER_TOKEN
}

const runs = new Map()
await fs.mkdir(path.join(dataRoot, 'runs'), { recursive: true })
function publicRun(run) {
  const { id, stage, progress, flightOptions, error, errorCode, issues, repair, agents, trip, conversation, planningRequested, createdAt, completedAt } = run
  return { id, stage, progress, flightOptions, error, errorCode, issues, repair, agents, trip, conversation, planningRequested, createdAt, completedAt }
}
async function persist(run) {
  const file = path.join(dataRoot, 'runs', run.id + '.json')
  await fs.writeFile(file + '.tmp', JSON.stringify(publicRun(run), null, 2))
  await replaceFile(file + '.tmp', file)
}
function send(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
async function withCover(run) {
  return run.trip ? {...run,trip:{...run.trip,cover:await storedTripCover(run.trip)}} : run
}
const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin
    if (origin && !/^http:\/\/(?:127\.0\.0\.1|localhost):(?:4178|4179|10086)$/.test(origin)) return send(res, 403, { error: 'Origin not allowed' })
    if (origin) res.setHeader('access-control-allow-origin', origin)
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { status: 'ready', runtime: 'DSH 0.2.1-rc.2', model: process.env.FLIGHTOR_DSH_MODEL || 'deepseek-flash', provider: process.env.FLIGHTOR_DSH_PROVIDER || 'deepseek-account' })
    if (req.method === 'GET' && url.pathname === '/api/flight-locations') return send(res, 200, { locations: searchFlightLocations(url.searchParams.get('q') || '') })
    if (req.method === 'GET' && url.pathname === '/api/trips') return send(res, 200, { trips: await listTrips() })
    const tripArchiveMatch = url.pathname.match(/^\/api\/trips\/((?:live-)?[a-f\d-]{36})\/archive$/)
    if (req.method === 'POST' && tripArchiveMatch) {
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 1000) return send(res, 413, {error:'Request too large'}) }
      return send(res, 200, await archiveTrip(tripArchiveMatch[1], JSON.parse(body).archived))
    }
    if (req.method === 'POST' && url.pathname === '/api/place-media') {
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 2000) return send(res, 413, { error: 'Request too large' }) }
      return send(res, 200, await loadPlaceMedia(JSON.parse(body)))
    }
    if (req.method === 'POST' && url.pathname === '/api/place-locations') {
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 2000) return send(res, 413, { error: 'Request too large' }) }
      return send(res, 200, await loadPlaceLocation(JSON.parse(body)))
    }
    const conversationMatch = url.pathname.match(/^\/api\/conversations\/([a-f\d-]{36})$/)
    const tripContextMatch = url.pathname.match(/^\/api\/trips\/((?:live-)?[a-f\d-]{36})\/context$/)
    if (req.method === 'GET' && tripContextMatch) {
      try { return send(res, 200, await loadTripContext(tripContextMatch[1])) }
      catch { return send(res, 404, { error: '无法恢复这段行程的原对话，请重试或重新开始。' }) }
    }
    if (req.method === 'GET' && conversationMatch) {
      try { return send(res, 200, await loadConversation(conversationMatch[1])) } catch { return send(res, 404, { error: '对话不存在' }) }
    }
    const selectionMatch = url.pathname.match(/^\/api\/conversations\/([a-f\d-]{36})\/flight-selection$/)
    if (req.method === 'POST' && selectionMatch) {
      if ([...runs.values()].some(item => !['completed', 'failed', 'cancelled'].includes(item.run.stage))) return send(res, 409, { error: '请等当前对话完成后再选择航班' })
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 1000) return send(res, 413, { error: 'Request too large' }) }
      return send(res, 200, await selectConversationFlight(selectionMatch[1], JSON.parse(body).selection))
    }
    const isConversation = url.pathname === '/api/conversations/turns'
    const isFlightSearch = url.pathname === '/api/flights/search'
    const isFlightDetails = url.pathname === '/api/flights/details'
    if (req.method === 'POST' && (url.pathname === '/api/runs' || isConversation || isFlightSearch || isFlightDetails)) {
      let body = ''
      for await (const chunk of req) { body += chunk; if (body.length > 16000) return send(res, 413, { error: 'Request too large' }) }
      const input = JSON.parse(body)
      if (isFlightDetails && (!/^[a-f\d-]{36}$/i.test(input.conversationId || '') || !/^[a-f\d-]{36}$/i.test(input.selection?.searchId || '') || !/^[a-f\d]{16}$/i.test(input.selection?.candidateId || '') || typeof input.select !== 'boolean')) return send(res, 400, { error: '无效的航班详情请求' })
      const query = isFlightSearch ? manualFlightQuery(input.query) : undefined
      const message = isConversation ? input.message : input.prompt
      if (!isFlightSearch && !isFlightDetails && (typeof message !== 'string' || !message.trim() || message.length > 4000)) return send(res, 400, { error: '请输入1到4000字的消息' })
      if (isConversation && input.action && !['chat', 'plan'].includes(input.action)) return send(res, 400, { error: '无效的对话操作' })
      if ((isConversation || isFlightSearch) && input.conversationId) {
        let conversation
        try { conversation = await loadConversation(input.conversationId) } catch { return send(res, 404, { error: '对话不存在，请重新开始' }) }
        resolveFlightSelection(conversation, input.flightSelection)
        if (isConversation) resolveTripContext(conversation, input.tripContext)
      } else if (input.flightSelection) return send(res, 400, { error: '请在查询所在的对话中选择航班' })
      if (isConversation && input.tripContext && !input.conversationId) return send(res, 400, {error:'请先恢复行程所属对话'})
      if ([...runs.values()].some(item => !['completed', 'failed', 'cancelled'].includes(item.run.stage))) return send(res, 409, { error: '本地 MVP 当前一次运行一个请求，请等待或取消当前任务' })
      const run = { id: crypto.randomUUID(), prompt: isConversation ? undefined : message, message: isConversation ? message : undefined, conversationId: input.conversationId, action: input.action || 'chat', constraints: input.constraints || {}, stage: 'queued', createdAt: new Date().toISOString() }
      if (isFlightSearch) run.query = query
      if (isFlightDetails) { run.selection = input.selection; run.select = input.select }
      if (isConversation && input.flightSelection) run.flightSelection = input.flightSelection
      if (isConversation && input.tripContext) run.tripContext = input.tripContext
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(Error('MVP 总运行时间超过12分钟')), 720000)
      const entry = { run, controller }
      runs.set(run.id, entry)
      await persist(run)
      send(res, 202, publicRun(run))
      entry.done = (isFlightDetails ? runFlightDetails : isFlightSearch ? runManualFlightSearch : isConversation ? runConversation : runPlan)(run, { signal: controller.signal, onChange: persist }).catch(error => console.error(`[${run.id}] ${error.message.slice(0, 350)}`)).finally(() => clearTimeout(timeout))
      return
    }
    const match = url.pathname.match(/^\/api\/runs\/([a-f\d-]{36})$/)
    if (match) {
      const id = match[1]
      const entry = runs.get(id)
      if (req.method === 'DELETE' && entry) {
        entry.controller.abort(Error('用户取消'))
        await entry.done
        return send(res, 200, publicRun(entry.run))
      }
      if (req.method === 'GET') {
        if (entry) return send(res, 200, await withCover(publicRun(entry.run)))
        try { return send(res, 200, await withCover(JSON.parse(await fs.readFile(path.join(dataRoot, 'runs', id + '.json'), 'utf8')))) } catch { return send(res, 404, { error: '任务不存在' }) }
      }
    }
    send(res, 404, { error: 'Not found' })
  } catch (error) { send(res, 400, { error: error.message.slice(0, 500) }) }
})
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('FlightOR DSH MVP: http://127.0.0.1:' + (process.env.PORT || 3000)))
let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  for (const entry of runs.values()) if (!['completed', 'failed', 'cancelled'].includes(entry.run.stage)) entry.controller.abort()
  await Promise.allSettled([...runs.values()].map(entry => entry.done))
  await flightWorker?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => { void shutdown().finally(() => process.exit(0)) })
server.once('error', () => { void flightWorker?.close() })
export { server, shutdown }
