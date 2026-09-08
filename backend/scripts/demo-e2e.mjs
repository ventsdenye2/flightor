// Live, local integration exercise. Credentials are loaded from environment,
// never written into evidence. This provisions a development test identity;
// it does not claim to verify the WeChat code exchange.
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { db } from '../dist/db/index.js'
import { env } from '../dist/config/env.js'
import { PostgresUserIdentityRepository } from '../dist/identity/postgres.js'
import { issueAccessToken } from '../dist/auth/tokens.js'

if (env.NODE_ENV === 'production' || !new URL(env.DATABASE_URL).pathname.endsWith('/flightor_demo')) throw new Error('Use the dedicated local flightor_demo database')
const base = 'http://127.0.0.1:3000'
await mkdir('.demo', { recursive: true })
const evidence = []
const record = async value => { evidence.push(value); console.log(JSON.stringify(value)); await writeFile('.demo/e2e-evidence.json', JSON.stringify(evidence, null, 2)) }
const resume = process.argv.includes('--continue') ? JSON.parse(await readFile('.demo/session.json', 'utf8')) : undefined
const identity = resume ? undefined : await new PostgresUserIdentityRepository(db).resolveWechat({ providerSubject: 'development-e2e-' + randomUUID(), nickname: '演示链路测试', avatarUrl: '' })
const token = resume?.accessToken ?? await issueAccessToken(identity, env)
const call = async (path, body, method = body === undefined ? 'GET' : 'POST', extra = {}) => {
  const r = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000) })
  const data = await r.json()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${data.error?.code || ''}`)
  return data
}
try {
  await record({ stage: 'health', ...(await call('/health/ready')), authentication: 'local development identity; WeChat exchange not exercised' })
  const { trip } = resume ? { trip: { id: resume.tripId } } : await call('/v1/trips', { title: '今晚演示：东京五日旅行' })
  const { conversation } = resume ? { conversation: { id: resume.conversationId } } : await call('/v1/conversations', { trip_id: trip.id })
  if (!resume) await writeFile('.demo/session.json', JSON.stringify({ accessToken: token, user: { uid: identity.publicId, nickname: identity.nickname, avatarUrl: '' }, tripId: trip.id, conversationId: conversation.id }))
  let turn = resume ? { tripContextSummary: (await call(`/v1/trips/${trip.id}/workspace`)).tripContextSummary } : undefined
  for (const message of resume ? [] : [
    '我从上海浦东PVG出发，目的地是东京成田NRT，玩5天，喜欢美术馆和日料，机票预算5000元人民币。先记录条件，暂不搜索航班。',
    '2026年10月10日出发，只规划去程，直飞优先。请查一下真实机票并保存搜索结果。'
  ]) {
    const start = Date.now()
    turn = await call('/v1/agent/converse', { tripId: trip.id, conversationId: conversation.id, message })
    await record({ stage: 'conversation', elapsedMs: Date.now() - start, message, reply: turn.reply, stopReason: turn.stopReason, delivery: turn.delivery, context: turn.tripContextSummary, artifactRefs: turn.artifactRefs, warnings: turn.warnings })
    if (!['responded', 'completed'].includes(turn.stopReason)) throw new Error('Planner did not complete this turn')
    if (turn.tripContextSummary.version < 1) throw new Error('Planner did not persist the supplied trip conditions')
    if (message.includes('查一下真实机票') && (turn.delivery?.status !== 'satisfied' || !turn.artifactRefs.some(ref => ref.type === 'flight_search'))) throw new Error('Planner did not deliver a verified flight-search artifact')
  }
  if (!turn.tripContextSummary.readyForRouteGeneration) throw new Error('Conversation did not establish eligible route input')
  let run
  let routeDeliveryGoalId
  const restoredRun = resume ? (await call(`/v1/trips/${trip.id}/workspace`)).routeGeneration : undefined
  if (restoredRun && restoredRun.contextVersion === turn.tripContextSummary.version && ['queued', 'running', 'succeeded'].includes(restoredRun.status)) {
    run = restoredRun
    if (process.argv.includes('--conversational-route')) routeDeliveryGoalId = run.goalId
    await record({ stage: 'generation_reused', runId: run.id, status: run.status })
  } else if (process.argv.includes('--conversational-route')) {
    const routeTurn = await call('/v1/agent/converse', { tripId: trip.id, conversationId: conversation.id,
      message: '请根据现在确认的条件生成可比较的去程路线，并保存结果。' })
    routeDeliveryGoalId = routeTurn.delivery?.goals?.find(goal => goal.kind === 'route_generation')?.goalId
    await record({ stage: 'route_conversation', reply: routeTurn.reply, stopReason: routeTurn.stopReason, delivery: routeTurn.delivery })
    run = (await call(`/v1/trips/${trip.id}/workspace`)).routeGeneration
    if (!routeDeliveryGoalId) throw new Error('Conversation did not register a route-generation Goal')
  } else {
    run = (await call(`/v1/trips/${trip.id}/route-generation-runs`, { conversationId: conversation.id, expectedTripVersion: turn.tripContextSummary.version }, 'POST', { 'idempotency-key': randomUUID() })).run
  }
  if (!run?.id) throw new Error('Run response missing id')
  const deadline = Date.now() + 180000
  let previous = ''
  while (Date.now() < deadline && !['succeeded', 'failed', 'cancelled'].includes(run.status)) {
    if (run.status + run.progress?.stage !== previous) { previous = run.status + run.progress?.stage; await record({ stage: 'generation_progress', run }) }
    await new Promise(resolve => setTimeout(resolve, 1500))
    const result = await call(`/v1/route-generation-runs/${run.id}`)
    run = result.run
  }
  await record({ stage: 'generation_terminal', run })
  if (run.status !== 'succeeded' || !run.resultArtifactId) throw new Error('Generation did not succeed')
  const { artifact } = await call(`/v1/artifacts/${run.resultArtifactId}`)
  const reps = artifact.payload.representatives
  if (!reps?.length || !reps.some(rep => rep.path.totalFare?.amount >= 0)) throw new Error('No priced representative route')
  await record({ stage: 'route_result', artifactId: artifact.id, routes: reps.map(rep => ({ pathId: rep.path.id, fare: rep.path.totalFare, duration: rep.path.totalDurationMinutes, airports: rep.path.nodes.map(n => n.location.iata), badges: rep.badges })), verification: artifact.verification })
  const beforeSave = await call(`/v1/trips/${trip.id}/workspace`)
  if (routeDeliveryGoalId) {
    const delivered = beforeSave.messages.some(message => message.delivery?.goals?.some(goal => goal.goalId === routeDeliveryGoalId && goal.status === 'satisfied'))
    if (!delivered) throw new Error('Background route result did not restore as server-verified delivery')
  }
  const saved = await call(`/v1/trips/${trip.id}`, { expectedVersion: beforeSave.trip.version, savedRoute: { artifactId: artifact.id, routeId: reps[0].path.id } }, 'PATCH')
  if (saved.trip.status !== 'saved' || saved.trip.savedRoute?.routeId !== reps[0].path.id) throw new Error('Route selection was not saved')
  await record({ stage: 'route_saved', trip: saved.trip })
  if (process.argv.includes('--with-guide')) {
    const start = Date.now()
    const message = process.argv.includes('--activity-only')
      ? '不需要特定展览或节庆信息，只研究东京美术馆和日料体验。请按当前日期保存五日攻略，每天都有带来源的安排；部分核实的信息请清楚标注。'
      : '请为这次东京5日旅行研究美术馆和日料活动，生成并保存有来源的逐日攻略，只在东京游览。'
    const guideTurn = await call('/v1/agent/converse', { tripId: trip.id, conversationId: conversation.id,
      message })
    await record({ stage: 'guide_conversation', elapsedMs: Date.now() - start, message, reply: guideTurn.reply, stopReason: guideTurn.stopReason, delivery: guideTurn.delivery, artifactRefs: guideTurn.artifactRefs, warnings: guideTurn.warnings })
    const deliveredGuideIds = new Set(guideTurn.delivery?.goals?.filter(goal => goal.kind === 'travel_guide' && goal.status === 'satisfied').flatMap(goal => goal.artifactIds) ?? [])
    const guideRef = guideTurn.artifactRefs?.findLast(ref => ref.type === 'travel_guide' && deliveredGuideIds.has(ref.id))
    if (guideTurn.stopReason !== 'completed' || guideTurn.delivery?.status !== 'satisfied' || !guideRef) throw new Error('Planner did not finish and save a verified guide')
    const { artifact: guide } = await call(`/v1/artifacts/${guideRef.id}`)
    await record({ stage: 'guide_result', artifactId: guide.id, days: guide.payload.days.map(day => ({ day: day.day, city: day.city, items: day.items.map(item => ({ title: item.title, verification: item.verification })) })), warnings: guide.payload.warnings })
    if (guide.payload.days.length !== 5 || guide.payload.days.some(day => day.items.length === 0)) throw new Error('Guide does not cover all five days')
    const restoredGuide = await call(`/v1/trips/${trip.id}/workspace`)
    if (!restoredGuide.artifactRefs.some(ref => ref.id === guide.id)
      || !restoredGuide.messages.some(message => message.delivery?.goals?.some(goal => goal.kind === 'travel_guide' && goal.status === 'satisfied' && goal.artifactIds.includes(guide.id)))) throw new Error('Verified guide did not survive cloud restoration')
  }
  const workspace = await call(`/v1/trips/${trip.id}/workspace`)
  if (workspace.trip.savedRoute?.routeId !== reps[0].path.id) throw new Error('Saved route did not survive cloud restoration')
  await record({ stage: 'cloud_restore', messageCount: workspace.messages?.length, artifactCount: workspace.artifactRefs?.length, runStatus: workspace.routeGeneration?.status })
  await record({ stage: 'completed', tripId: trip.id, conversationId: conversation.id })
} catch (error) {
  await record({ stage: 'failed', message: error.message })
  process.exitCode = 1
} finally { await db.destroy() }
