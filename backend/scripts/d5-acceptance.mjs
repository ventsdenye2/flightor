// Frozen-batch acceptance: local HTTP model simulation and persisted fare fixtures.
// This runner never loads .env or makes external provider requests.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPlanningScenario } from '../dist/agent/dsh/d5-planning-scenarios.js'
import { runBudgetRoutingScenario } from '../dist/flight-routing/d5-budget-scenarios.js'

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(backend, '..')
async function fingerprint() {
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', '.git', 'vendor'].includes(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (/\.(?:ts|mjs|json)$/.test(path)) files.push(path)
    }
  }
  for (const dir of ['src', 'dist', 'dsh-runtime', 'scripts']) await walk(join(backend, dir))
  const hash = createHash('sha256')
  for (const path of files.sort()) hash.update(relative(backend, path)).update('\0').update(await readFile(path)).update('\0')
  return { sha256: hash.digest('hex'), files: files.length }
}
const initial = await fingerprint()
const batch = { batchId: new Date().toISOString().replace(/[:.]/g, '-'),
  providerMode: 'local-http-simulation-and-persisted-fare-fixtures', realProvider: false,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  code: initial, runs: [] }
const output = resolve(repo, 'docs/design/budget-travel-agent/evidence', `d5-${batch.batchId}.json`)
await mkdir(dirname(output), { recursive: true })
for (let caseNumber = 1; caseNumber <= 10; caseNumber++) {
  for (let runIndex = 1; runIndex <= 3; runIndex++) {
    const start = performance.now()
    try {
      const metrics = caseNumber >= 7 && caseNumber <= 9
        ? await runBudgetRoutingScenario(caseNumber, runIndex)
        : await runPlanningScenario(caseNumber, runIndex)
      const pass = metrics.pass ?? metrics.accepted
      batch.runs.push({ caseNumber, runIndex, pass: pass === true, wallTimeMs: performance.now() - start, ...metrics })
    } catch (error) {
      batch.runs.push({ caseNumber, runIndex, pass: false, wallTimeMs: performance.now() - start,
        failureClass: 'scenario_assertion_or_execution', error: String(error?.message ?? error).slice(0, 240) })
    }
    await writeFile(output, JSON.stringify(batch, null, 2) + '\n')
    console.log(JSON.stringify(batch.runs.at(-1)))
  }
}
const final = await fingerprint()
batch.codeUnchanged = initial.sha256 === final.sha256
const plan = batch.runs.filter(run => run.caseNumber <= 6 || run.caseNumber === 10)
const routes = batch.runs.filter(run => run.caseNumber >= 7 && run.caseNumber <= 9)
const sum = (rows, field) => rows.reduce((total, row) => total + (row[field] ?? 0), 0)
const percentile = (rows, field, p) => rows.map(row => row[field] ?? 0).sort((a,b) => a-b)[Math.ceil(rows.length*p)-1]
const recovered = plan.filter(run => run.pass && ((run.providerRetries ?? 0) + (run.schemaRepairCount ?? 0) + (run.semanticRepairCount ?? 0) > 0))
batch.metrics = {
  runs: batch.runs.length, passed: batch.runs.filter(run => run.pass).length,
  // Planning rates use the 21 planning runs; injected fault cases are included.
  planningRuns: plan.length, firstAttemptCompletionRate: (plan.filter(run => run.pass).length - recovered.length) / plan.length,
  completionRateAfterAutomaticRecovery: plan.filter(run => run.pass).length / plan.length,
  unrecoveredFailureRate: plan.filter(run => !run.pass).length / plan.length,
  averageModelCalls: sum(plan, 'modelCalls') / plan.length,
  p50ModelCalls: percentile(plan, 'modelCalls', .5), p95ModelCalls: percentile(plan, 'modelCalls', .95),
  averageSearchCalls: sum(plan, 'searchCalls') / plan.length,
  p50TurnWallTimeMs: percentile(plan, 'wallTimeMs', .5), p95TurnWallTimeMs: percentile(plan, 'wallTimeMs', .95),
  providerRetryCount: sum(plan, 'providerRetries'), schemaRepairCount: sum(plan, 'schemaRepairCount'),
  semanticRepairCount: sum(plan, 'semanticRepairCount'),
  routeCandidateCount: sum(routes, 'routeCandidates'), fareLookupCount: sum(routes, 'observedFareLookupCount'),
  pricedRouteCount: sum(routes, 'pricedRoutes'), cheapestRouteAvailability: routes.filter(run => run.cheapestAvailable !== undefined).length / routes.length,
  invalidEvidenceRejectionCount: sum(routes, 'missingBindingRejections'),
  knownProviderCost: 0, unknownProviderCost: 0, costScope: 'simulation only; historical live ledger untouched',
}
batch.pass = batch.codeUnchanged && batch.runs.length === 30 && batch.runs.every(run => run.pass)
await writeFile(output, JSON.stringify(batch, null, 2) + '\n')
console.log(JSON.stringify({ pass: batch.pass, codeUnchanged: batch.codeUnchanged, metrics: batch.metrics, output }, null, 2))
if (!batch.pass) process.exitCode = 1
