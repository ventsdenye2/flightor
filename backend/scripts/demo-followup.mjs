// Continue the isolated development E2E identity, without bypassing WeChat login in the app.
import { readFile, writeFile } from 'node:fs/promises'
import { env } from '../dist/config/env.js'
if (env.NODE_ENV === 'production' || !new URL(env.DATABASE_URL).pathname.endsWith('/flightor_demo')) throw new Error('Use flightor_demo only')
const session = JSON.parse(await readFile('.demo/session.json', 'utf8'))
const message = process.argv.slice(2).find(arg => !arg.startsWith('--')) || '请读取刚生成的路线，告诉我最便宜的一条的航班号、出发和到达时间、价格。不要重新搜索。'
const start = Date.now()
const response = await fetch('http://127.0.0.1:3000/v1/agent/converse', {
  method: 'POST', headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ tripId: session.tripId, conversationId: session.conversationId, message }), signal: AbortSignal.timeout(180000)
})
const result = { httpStatus: response.status, elapsedMs: Date.now() - start, message, result: await response.json() }
if (process.argv.includes('--assert-guide') && response.ok) {
  const ref = result.result.artifactRefs?.findLast(item => item.type === 'travel_guide')
  if (ref) {
    const r = await fetch(`http://127.0.0.1:3000/v1/artifacts/${ref.id}`, { headers: { authorization: `Bearer ${session.accessToken}` } })
    const { artifact } = await r.json()
    result.guide = { id: artifact?.id, createdAt: artifact?.createdAt, days: artifact?.payload?.days, warnings: artifact?.payload?.warnings }
    if (!r.ok || Date.parse(artifact?.createdAt) < start || artifact?.payload?.days?.length !== 5 || artifact.payload.days.some(day => !day.items.length)) result.validationError = 'A newly saved guide must contain sourced items on all five days'
  } else result.validationError = 'No guide artifact returned'
}
console.log(JSON.stringify(result))
await writeFile(`.demo/followup-${Date.now()}.json`, JSON.stringify(result, null, 2))
if (!response.ok || result.result.stopReason !== 'completed' || result.validationError) process.exitCode = 1
