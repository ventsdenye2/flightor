// Explicit, bounded editorial smoke test. No Planner runtime, research or DB writes.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { env } from '../dist/config/env.js'
import { OpenRouterClient } from '../dist/providers/openrouter/client.js'
import { GuideFinalizer } from '../dist/travel-guides/finalization.js'
import { admittedResearch } from '../dist/travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../dist/travel-guides/artifact.js'
import { installG1Budget } from './g1-budget.mjs'

const directory = path.resolve('.demo/guide-finalization-20260922')
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ dryRun: true, model: env.PLANNER_MODEL, limitUsd: 2, directory, calls: 'at most 12; 0 search' }))
  process.exit(0)
}
if (process.env.FINALIZATION_AUTHORIZED_USD !== '2') throw new Error('CURRENT_AUTHORIZATION_REQUIRED')
const originalFetch = globalThis.fetch
const catalog = await originalFetch(`${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(20000) }).then(r => r.json())
const pricing = catalog.data?.find(item => item.id === env.PLANNER_MODEL)?.pricing
if (!pricing) throw new Error('CURRENT_MODEL_PRICING_REQUIRED')
fs.mkdirSync(directory, { recursive: true })
const prior = ['.demo/g1-live-2026-09-20T12-12-39-743Z/ledger.json', '.demo/g1-weapp-20260922/ledger.json']
  .filter(file => fs.existsSync(file)).map(file => ({ path: path.resolve(file), sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') }))
const authorization = path.join(directory, 'authorization.json')
if (!fs.existsSync(authorization)) fs.writeFileSync(authorization, JSON.stringify({
  instruction: '本轮用户明确：可以调用真实模型进行测试，费用上限$2', limitUsd: 2,
  model: env.PLANNER_MODEL, pricing, prior, searchAllowed: false
}, null, 2))
const meter = installG1Budget({ directory, model: env.PLANNER_MODEL, pricing, limitUsd: 2,
  resume: fs.existsSync(path.join(directory, 'ledger.json')), callLimits: { model: 12, serp: 1 }, fetchImpl: originalFetch })
const pending = new Set()
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.href !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('FINALIZATION_NO_SEARCH_OR_OTHER_PROVIDER')
  const task = meter.fetch(input, init)
  pending.add(task); task.finally(() => pending.delete(task)).catch(() => {})
  return task
}
try {
  const samples = JSON.parse(fs.readFileSync('test/fixtures/g1-publication-v1-original-samples.json', 'utf8')).cases
  const sample = samples[0].legacy
  const guide = travelGuideArtifactPayloadSchema.parse(sample.artifact.payload)
  const client = new OpenRouterClient(env)
  const finalizer = new GuideFinalizer({ complete: async (...args) => {
    const completion = await client.complete(...args)
    fs.writeFileSync(path.join(directory, `completion-${Date.now()}.json`), JSON.stringify(completion, null, 2))
    return completion
  } }, env.PLANNER_MODEL, { reasoning: { enabled: false, exclude: true } })
  const results = []
  for (const locale of process.argv.includes('--zh-only') ? ['zh'] : ['zh', 'en']) {
    const result = await finalizer.generate({ locale, guide, research: admittedResearch(sample.researchArtifacts),
      requirements: { currentMessage: '自备机票，东京两天，喜欢文化和小吃，节奏轻松。', dates: ['2026-10-20', '2026-10-21'], budget: guide.budget } })
    results.push({ locale, mode: 'initial', ...result })
  }
  const accepted = results.find(result => result.status === 'accepted')?.text
  if (accepted && !process.argv.includes('--zh-only')) results.push({ locale: accepted.locale === 'zh' ? 'en' : 'zh', mode: 'localization',
    ...await finalizer.generate({ locale: accepted.locale === 'zh' ? 'en' : 'zh', guide, research: [], requirements: null, accepted }) })
  const report = { model: env.PLANNER_MODEL, results, ledger: meter.ledger, priorUnchanged: prior.every(value =>
    createHash('sha256').update(fs.readFileSync(value.path)).digest('hex') === value.sha256) }
  const filename = path.join(directory, `report-${Date.now()}.json`)
  fs.writeFileSync(filename, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ filename, priorUnchanged: report.priorUnchanged,
    results: results.map(({ locale, mode, status, issues, observation }) => ({ locale, mode, status, issues, observation })) }, null, 2))
} finally { await Promise.allSettled([...pending]); globalThis.fetch = originalFetch; meter.close() }
