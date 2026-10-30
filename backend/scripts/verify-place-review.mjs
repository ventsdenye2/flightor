// A single real reviewer Session verifies tool use; the planner draft is fixed and makes no model call.
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { DshAgent } from '../src/dsh.mjs'
import { runPlan } from '../src/plan.mjs'
import { dataRoot } from '../src/paths.mjs'
const id = crypto.randomUUID(), started = Date.now(), calls = []
class SeededPlannerAgent extends DshAgent {
  async start(persona) { if (this.role !== 'planner') return super.start(persona) }
  async run(prompt, signal) {
    if (this.role === 'planner') return { text: '巴黎一日，2026-11-07，一人，喜欢建筑、历史与散步。不查机票。上午卢浮宫（Louvre Museum，Paris）：欣赏宫殿与馆藏，具体票价和预约尚未核实。下午蒙马特圣心大教堂（Sacré-Cœur Basilica，Paris）：游览建筑与山丘街道；傍晚亚历山大三世桥（Pont Alexandre III，Paris）：步行看塞纳河。来源为空，介绍保持克制。' }
    return super.run(prompt, signal)
  }
}
const run = { id, prompt: '按草稿整理巴黎一天建筑散步，不要查询机票；把全部明确景点一次交lookup_places_batch，按工具返回仅修正not-found字段一次。', stage: 'queued', createdAt: new Date().toISOString() }
try {
  await runPlan(run, { Agent: SeededPlannerAgent, signal: AbortSignal.timeout(240000), onChange: async value => {
    if (calls.at(-1) !== value.stage) { calls.push(value.stage); console.log(JSON.stringify({ stage: value.stage, elapsedMs: Date.now() - started })) }
  } })
} catch (error) { run.error = error.message; process.exitCode = 1 }
await fs.mkdir(path.join(dataRoot, 'verification'), { recursive: true })
const file = path.join(dataRoot, 'verification', `place-review-${id}.json`)
await fs.writeFile(file, JSON.stringify({ ...run, elapsedMs: Date.now() - started, note: 'Fixed planner draft; one real reviewer Session; no flight query.' }, null, 2))
if (run.stage === 'completed') {
  await fs.mkdir(path.join(dataRoot, 'runs'), { recursive: true })
  await fs.writeFile(path.join(dataRoot, 'runs', id + '.json'), JSON.stringify({ id, stage: run.stage, trip: run.trip, createdAt: run.createdAt, completedAt: run.completedAt, verification: true }, null, 2), { flag: 'wx' })
}
const activities = run.trip?.days.flatMap(day => day.activities) || []
console.log(JSON.stringify({ id, stage: run.stage, placesResolved: run.trip?.placesResolved, activities: activities.length, images: activities.filter(a => a.media?.src).length, coordinates: activities.filter(a => Number.isFinite(a.latitude)).length, elapsedMs: Date.now() - started, evidence: file, error: run.error }, null, 2))
