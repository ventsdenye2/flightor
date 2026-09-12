// Uses the current build and real providers without starting/replacing an API server.
// Creates only a development identity/trip in flightor_demo; never saves credentials.
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { buildApp } from '../dist/app.js'
import { db } from '../dist/db/index.js'
import { env } from '../dist/config/env.js'
import { createProviders } from '../dist/providers/index.js'
import { PostgresUserIdentityRepository } from '../dist/identity/postgres.js'
import { issueAccessToken } from '../dist/auth/tokens.js'
import { PostgresLocationResolver } from '../dist/aviation/location-resolver.js'

if (env.NODE_ENV === 'production' || new URL(env.DATABASE_URL).pathname !== '/flightor_demo') {
  throw new Error('Use the dedicated local flightor_demo database')
}
if (!env.OPENROUTER_API_KEY || !env.SERPAPI_KEY) throw new Error('Configure OPENROUTER_API_KEY and SERPAPI_KEY')

await mkdir('.demo', { recursive: true })
const evidencePath = `.demo/guide-mvp-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
const evidence = []
let writeQueue = Promise.resolve()
const record = value => {
  evidence.push(value)
  console.log(JSON.stringify(value))
  const snapshot = JSON.stringify(evidence, null, 2)
  writeQueue = writeQueue.then(() => writeFile(evidencePath, snapshot))
  return writeQueue
}
const providers = createProviders(env)
const resumeIndex = process.argv.indexOf('--resume')
const resumePath = resumeIndex < 0 ? undefined : process.argv[resumeIndex + 1]
if (resumeIndex >= 0 && !resumePath) throw new Error('--resume needs a prior guide-mvp evidence JSON path')
const previousEvidence = resumePath ? JSON.parse(await readFile(resumePath, 'utf8')) : undefined
const previousTurn = previousEvidence?.findLast(entry => entry.stage === 'conversation')
if (resumePath && !previousTurn?.tripId) throw new Error('The evidence has no prior guide conversation')
const observedToolCalls = new Set()
const chat = providers.openrouter.chat.bind(providers.openrouter)
providers.openrouter.chat = async (...args) => {
  for (const message of args[0]) {
    if (message.role !== 'tool' || observedToolCalls.has(message.tool_call_id)) continue
    observedToolCalls.add(message.tool_call_id)
    await record({ stage: 'tool_result', name: message.name, content: message.content })
  }
  const start = Date.now()
  let result
  try { result = await chat(...args) } catch (error) {
    await record({ stage: 'model_error', model: args[1], elapsedMs: Date.now() - start, code: error.code, name: error.name })
    throw error
  }
  const message = result.choices?.[0]?.message
  await record({ stage: 'model', model: args[1], elapsedMs: Date.now() - start,
    tools: message?.tool_calls?.map(call => ({ name: call.function.name, arguments: call.function.arguments })) ?? [],
    usage: result.usage })
  return result
}
const search = providers.researchSearch.search.bind(providers.researchSearch)
providers.researchSearch.search = async (...args) => {
  const start = Date.now()
  const result = await search(...args)
  await record({ stage: 'search', provider: 'serpapi', elapsedMs: Date.now() - start, candidates: result.candidates.length })
  return result
}

let app
try {
  app = await buildApp({ db, redis: undefined, env: { ...env, REDIS_ENABLED: false, LOG_LEVEL: 'error' }, providers })
  const identity = previousTurn
    ? await db.selectFrom('trips').innerJoin('users', 'users.id', 'trips.user_id')
      .select(['users.id as userId', 'users.public_id as publicId'])
      .where('trips.public_id', '=', previousTurn.tripId)
      .where('users.wechat_openid', 'like', 'development-guide-mvp-%').executeTakeFirstOrThrow()
    : await new PostgresUserIdentityRepository(db).resolveWechat({
      providerSubject: `development-guide-mvp-${randomUUID()}`, nickname: '路线生成 MVP 验收', avatarUrl: ''
    })
  const token = await issueAccessToken(identity, env)
  const call = async (url, payload) => {
    const response = await app.inject({ method: payload === undefined ? 'GET' : 'POST', url,
      headers: { authorization: `Bearer ${token}` }, ...(payload === undefined ? {} : { payload }) })
    const data = response.json()
    if (response.statusCode >= 400) throw new Error(`${url}: ${response.statusCode} ${data.error?.code ?? ''}`)
    return data
  }
  await record({ stage: 'health', ...(await call('/health/ready')), evidencePath,
    authentication: 'development identity; WeChat exchange and device UI are not exercised',
    search: 'real SerpApi', plannerModel: env.PLANNER_MODEL, researchModel: env.RESEARCH_MODEL })
  const fromEmptyTrip = process.argv.includes('--from-empty-trip')
  const { matches } = await new PostgresLocationResolver(db).resolveLocation({ query: 'Tokyo', types: ['city'], limit: 5 })
  const city = matches.find(location => location.cityCode === 'TYO')
  if (!city) throw new Error('Seed the Tokyo reference city before running this demo')
  const initialContext = {
    destinationIntent: { mode: 'explicit', required: [city], preferred: [], excluded: [] },
    departureWindow: { from: '2026-10-10', to: '2026-10-10', precision: 'exact' },
    travelDays: 5, budget: { amount: 5000, currency: 'CNY', scope: 'trip' },
    interests: ['美术馆', '日料', '安静街区'], pace: 'relaxed',
    notes: ['第一天安排少一点', '本次只规划游玩，不查机票', '不需要特定展览或节庆']
  }
  const { trip } = previousTurn ? { trip: { id: previousTurn.tripId } }
    : await call('/v1/trips', { title: 'MVP：东京五日美术馆与日料', ...(fromEmptyTrip ? {} : { initial_context: initialContext }) })
  await record({ stage: 'trip_setup', mode: previousTurn ? 'resumed' : fromEmptyTrip ? 'empty_trip' : 'confirmed_context',
    ...(previousTurn ? { resumePath } : fromEmptyTrip ? {} : { initialContext }) })
  const { conversation } = previousTurn ? { conversation: { id: previousTurn.conversationId } }
    : await call('/v1/conversations', { trip_id: trip.id })
  const start = Date.now()
  const request = '请研究具体去处，给我每天有重点、有推荐理由和大致时段的五日攻略并保存，每天至少一个有来源的安排；部分核实的信息清楚标注，不要把开放时间或交通耗时当成已核实事实。'
  const message = previousTurn ? '继续完成并保存五日攻略，保持已确认的要求，复用已有合格研究，部分核实的信息继续标明。'
    : fromEmptyTrip
    ? '我计划2026年10月10日至14日在东京玩5天，整体预算5000元人民币，喜欢美术馆、日料和安静街区，节奏轻松，第一天安排少一点。暂时只规划游玩，不查机票，也不需要特定展览或节庆。' + request
    : '请按已确认的东京五日行程条件生成游玩攻略，第一天少安排。不查机票，不需要特定展览或节庆。' + request
  const turn = await call('/v1/agent/converse', { tripId: trip.id, conversationId: conversation.id, message })
  await record({ stage: 'conversation', elapsedMs: Date.now() - start, message, ...turn })
  const workspace = await call(`/v1/trips/${trip.id}/workspace`)
  const satisfiedIds = new Set(turn.delivery?.goals?.filter(goal => goal.kind === 'travel_guide' && goal.status === 'satisfied')
    .flatMap(goal => goal.artifactIds) ?? [])
  const guideRef = turn.artifactRefs.findLast(ref => ref.type === 'travel_guide' && satisfiedIds.has(ref.id))
  if (turn.stopReason !== 'completed' || turn.delivery?.status !== 'satisfied' || !guideRef) {
    await record({ stage: 'incomplete_workspace', artifactRefs: workspace.artifactRefs, messages: workspace.messages })
    throw new Error('A completed, server-verified travel guide was not delivered')
  }
  const { artifact: guide } = await call(`/v1/artifacts/${guideRef.id}`)
  await record({ stage: 'guide', artifact: guide })
  const days = guide.payload.days
  if (guide.payload.composition !== 'agent_authored' || days.length !== 5
    || days.some(day => !day.theme || !day.items.length || day.items.some(item => !item.timeOfDay || !item.planningNote))) {
    throw new Error('Saved guide is missing the authored five-day schedule')
  }
  if (!workspace.artifactRefs.some(ref => ref.id === guide.id)
    || !workspace.messages.some(entry => entry.delivery?.goals?.some(goal => goal.status === 'satisfied' && goal.artifactIds.includes(guide.id)))) {
    throw new Error('Verified guide did not survive workspace restoration')
  }
  await record({ stage: 'completed', tripId: trip.id, conversationId: conversation.id, guideId: guide.id,
    elapsedMs: Date.now() - start, dayItemCounts: days.map(day => day.items.length),
    searchCalls: evidence.filter(entry => entry.stage === 'search').length, restored: true, evidencePath })
} catch (error) {
  await record({ stage: 'failed', message: error.message })
  process.exitCode = 1
} finally {
  await app?.close()
  await db.destroy()
  await writeQueue
}
