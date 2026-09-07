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
    '2026年10月10日出发，只规划去程，直飞优先。请查一下真实机票。'
  ]) {
    const start = Date.now()
    turn = await call('/v1/agent/converse', { tripId: trip.id, conversationId: conversation.id, message })
    await record({ stage: 'conversation', elapsedMs: Date.now() - start, message, reply: turn.reply, stopReason: turn.stopReason, context: turn.tripContextSummary, artifactRefs: turn.artifactRefs, warnings: turn.warnings })
    if (turn.stopReason !== 'completed') throw new Error('Planner did not complete this turn')
  }
  if (!turn.tripContextSummary.readyForRouteGeneration) throw new Error('Conversation did not establish eligible route input')
  const started = await call(`/v1/trips/${trip.id}/route-generation-runs`, { conversationId: conversation.id, expectedTripVersion: turn.tripContextSummary.version }, 'POST', { 'idempotency-key': randomUUID() })
  let run = started.run
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
  const workspace = await call(`/v1/trips/${trip.id}/workspace`)
  await record({ stage: 'cloud_restore', messageCount: workspace.messages?.length, artifactCount: workspace.artifactRefs?.length, runStatus: workspace.routeGeneration?.status })
  await record({ stage: 'completed', tripId: trip.id, conversationId: conversation.id })
} catch (error) {
  await record({ stage: 'failed', message: error.message })
  process.exitCode = 1
} finally { await db.destroy() }
