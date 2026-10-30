import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataRoot } from '../src/paths.mjs'
import { runPlan } from '../src/plan.mjs'
const input = process.argv[2] ? JSON.parse(await fs.readFile(process.argv[2], 'utf8')) : { prompt: '我已经买好机票，一个人，2026-11-07到2026-11-08在东京玩两天，喜欢历史和散步，必须去浅草寺，不去迪士尼。不需要查机票。每一天安排两到三处即可，请查询真实资料并给出来源。', constraints: { expectedDays: 2, startDate: '2026-11-07', endDate: '2026-11-08', requiredPlaces: ['浅草寺'], excludedPlaces: ['迪士尼'] } }
const run = { id: crypto.randomUUID(), ...input, stage: 'queued', createdAt: new Date().toISOString() }
console.log(JSON.stringify({ id: run.id, phase: 'starting' }))
const start = Date.now()
try {
  await runPlan(run, { signal: AbortSignal.timeout(720000), onChange: value => { console.log(JSON.stringify({ id: value.id, stage: value.stage, elapsedSeconds: Math.round((Date.now() - start) / 1000) })); return Promise.resolve() } })
} catch (error) { console.error(error.message); process.exitCode = 1 }
await fs.mkdir(path.join(dataRoot, 'verification'), { recursive: true })
await fs.writeFile(path.join(dataRoot, 'verification', run.id + '.json'), JSON.stringify({ ...run, elapsedMs: Date.now() - start }, null, 2))
console.log(JSON.stringify({ id: run.id, stage: run.stage, issues: run.issues, repair: run.repair, error: run.error, days: run.trip?.days.length, sources: run.trip?.sources.length, elapsedMs: Date.now() - start }))
