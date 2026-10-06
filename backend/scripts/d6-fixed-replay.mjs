#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const backendRoot = resolve(scriptDir, '..')
const options = parseArgs(process.argv.slice(2))
const baselineDist = resolve(options.baselineDist ?? resolve(backendRoot, '.demo', 'd6-baseline', 'backend', 'dist'))
const currentDist = resolve(options.currentDist ?? resolve(backendRoot, 'dist'))
const outputDir = resolve(options.outputDir ?? resolve(backendRoot, '.demo', 'd6-fixed-replay'))

if (!options.execute) {
  process.stdout.write(`${JSON.stringify({ mode: 'dry-run', executeRequired: true, baselineDist, currentDist, outputDir,
    scenario: 'Tokyo two days, three distinct visits, one fixed evidence source', samples: 10, warmups: 1,
    network: 'disabled by harness design', modelCalls: 0 }, null, 2)}\n`)
  process.exit(0)
}

for (const path of [baselineDist, currentDist]) {
  if (!existsSync(resolve(path, 'agent/dsh/commit-guide.js'))) throw new Error(`Missing compiled DSH modules under ${path}`)
}
await mkdir(outputDir, { recursive: true })
const fixtureModules = ['trips/types.js', 'trips/repository.js', 'artifacts/repository.js', 'conversations/repository.js',
  'memory/repository.js', 'agent/goals/repository.js', 'agent/goals/default-verifiers.js', 'agent/dsh/evidence.js',
  'agent/dsh/commit-guide.js', 'travel-guides/publication.js', 'travel-guides/artifact.js']
const moduleCache = new Map()
const observations = new Map()
async function load(distRoot, relative) {
  const path = resolve(distRoot, relative)
  const cacheKey = `${distRoot}${sep}${relative}`
  if (!moduleCache.has(cacheKey)) moduleCache.set(cacheKey, import(pathToFileURL(path).href))
  return moduleCache.get(cacheKey)
}

async function treeFingerprint(root) {
  const hash = createHash('sha256')
  let fileCount = 0
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) {
        const relative = path.slice(root.length + 1).replaceAll('\\', '/')
        hash.update(relative).update('\0').update(await readFile(path)).update('\0')
        fileCount++
      }
    }
  }
  await visit(root)
  return { sha256: hash.digest('hex'), fileCount }
}

function parseArgs(args) {
  const values = { execute: false }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--execute') values.execute = true
    else if (['--baseline-dist', '--current-dist', '--output-dir'].includes(arg)) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`)
      values[{ '--baseline-dist': 'baselineDist', '--current-dist': 'currentDist', '--output-dir': 'outputDir' }[arg]] = value
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  return values
}

function instrument(target, label, counts) {
  for (const name of ['get', 'create', 'createWithResearchAudit', 'update', 'listForTrip', 'listForGoal', 'listForRun',
    'getForScope', 'saveFinalVariant', 'getWorkspace']) {
    if (typeof target[name] !== 'function') continue
    const original = target[name].bind(target)
    target[name] = (...args) => {
      counts[`${label}.${name}`] = (counts[`${label}.${name}`] ?? 0) + 1
      return original(...args)
    }
  }
}

function p50(values) {
  if (!values.length) return null
  const ordered = [...values].sort((a, b) => a - b)
  const middle = ordered.length / 2
  return middle % 1 ? ordered[Math.floor(middle)] : (ordered[middle - 1] + ordered[middle]) / 2
}

function semanticGuide(guide, publication) {
  const text = publication?.finalization?.variants?.en?.text
  if (!guide || !text) return null
  const location = value => ({ id: value.id, type: value.type, name: value.name,
    countryCode: value.countryCode, cityCode: value.cityCode ?? null, iata: value.iata ?? null })
  return {
    days: guide.days.map(day => ({ day: day.day, city: location(day.city), kind: day.kind, theme: day.theme, notes: day.notes ?? null,
      items: day.items.map(item => ({ title: item.title, description: item.description, category: item.category,
        timeOfDay: item.timeOfDay ?? 'flexible', planningNote: item.planningNote ?? null })) })),
    budget: guide.budget ?? null,
    text: { reply: text.reply, overview: text.overview, days: text.days,
      activities: text.activities.map(activity => ({ name: activity.name, introduction: activity.introduction,
        recommendationReason: activity.recommendationReason })) }
  }
}

async function runOne(distRoot, style, pairIndex, warmup = false) {
  const started = performance.now()
  const counts = {}
  const observation = { counts, adapterMs: 0, stage: 'fixture_setup' }
  observations.set(`${style}:${pairIndex}`, observation)
  const ids = { trip: randomUUID(), conversation: randomUUID(), generation: randomUUID() }
  const ownerId = `d6-fixed-replay-${style}`
  const location = { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO' }
  const scope = { ownerId, tripId: ids.trip, conversationId: ids.conversation, generationId: ids.generation, tripContextVersion: 1 }
  const [tripTypes, tripRepoModule, artifactRepoModule, conversationRepoModule, memoryRepoModule, goalRepoModule,
    verifierModule, evidenceModule, commitModule, publicationModule, guideModule] = await Promise.all(fixtureModules.map(file => load(distRoot, file)))
  const trip = { ...tripTypes.emptyTripContext(ids.trip), version: 1, travelDays: 2,
    departureWindow: { from: '2026-11-03', to: '2026-11-03', precision: 'exact' },
    budget: { amount: 1200, currency: 'CNY', scope: 'trip' },
    destinationIntent: { mode: 'explicit', required: [location], preferred: [], excluded: [] }, interests: ['traditional culture', 'local food'] }
  const trips = new tripRepoModule.InMemoryTripContextRepository([trip])
  const owned = new Set([ids.trip])
  const artifacts = new artifactRepoModule.InMemoryArtifactRepository(ownerId, owned)
  const conversations = new conversationRepoModule.InMemoryConversationRepository(ownerId, owned)
  const conversation = await conversations.create({ tripId: ids.trip })
  const goals = new goalRepoModule.InMemoryGoalRepository(ownerId)
  const runs = new goalRepoModule.InMemoryGoalRunRepository(ownerId, goals)
  instrument(trips, 'trips', counts); instrument(artifacts, 'artifacts', counts)
  instrument(conversations, 'conversations', counts); instrument(goals, 'goals', counts); instrument(runs, 'goalRuns', counts)
  const evidence = new evidenceModule.DshEvidenceStore(scope)
  const source = await evidence.recordSearch({ sources: [{ url: 'https://www.gotokyo.org/en/spot/15/index.html', title: 'Tokyo cultural places',
    snippet: 'The district includes temple grounds, cultural exhibits, and a garden path for a relaxed visit.' }] }, 'fixed-fixture', 'fixture-search')
  const candidates = [
    { key: 'temple', title: 'Temple grounds', summary: 'Explore the temple grounds and traditional architecture.', category: 'activity' },
    { key: 'museum', title: 'Cultural exhibits', summary: 'Explore indoor cultural exhibits.', category: 'activity' },
    { key: 'garden', title: 'Garden walk', summary: 'Enjoy a relaxed garden walk.', category: 'activity' }
  ].map(value => ({ ...value, ...(style === 'd6' ? { sourceRefs: source.sourceRefs } : { evidenceRefs: source.evidenceRefs }), locationId: location.id }))
  const activityTexts = [
    { name: 'Temple grounds', introduction: 'Explore the temple grounds and traditional architecture.', recommendationReason: 'This visit fits your interest in traditional culture.' },
    { name: 'Cultural exhibits', introduction: 'Explore indoor cultural exhibits.', recommendationReason: 'This visit adds an indoor cultural stop.' },
    { name: 'Garden walk', introduction: 'Enjoy a relaxed garden walk.', recommendationReason: 'This visit leaves room for a quiet local experience.' }
  ]
  const intent = { kind: 'travel_guide', parameters: { questions: ['Traditional culture and local food'], researchTypes: ['activity'],
    requiredEvidenceTypes: ['activity'], maxResults: 10, maxCities: 1, allowPartial: true } }
  const fullInput = { intent, candidates, days: [
    { day: 1, cityId: location.id, kind: 'visit', theme: 'Traditional Tokyo', items: [
      { activityKey: 'temple', candidateKey: 'temple', timeOfDay: 'morning', planningNote: 'Explore traditional architecture at a relaxed pace.' },
      { activityKey: 'museum', candidateKey: 'museum', timeOfDay: 'afternoon', planningNote: 'Explore indoor cultural exhibits.' }] },
    { day: 2, cityId: location.id, kind: 'visit', theme: 'Culture and gardens', items: [
      { activityKey: 'garden', candidateKey: 'garden', timeOfDay: 'morning', planningNote: 'Enjoy a relaxed garden walk.' }] }
  ], text: { reply: 'Your two-day Tokyo cultural guide is ready.', overview: 'Explore traditional culture and enjoy local places at a relaxed pace.',
    days: [{ day: 1, theme: 'Traditional Tokyo' }, { day: 2, theme: 'Culture and gardens' }],
    activities: activityTexts.map((text, index) => ({ ...text, activityKey: ['temple', 'museum', 'garden'][index] })) } }
  let input = fullInput
  let adapterMs = 0
  if (style === 'd6') {
    const preparationModule = await load(distRoot, 'agent/dsh/preparation.js')
    const adaptStart = performance.now()
    input = preparationModule.adaptDshCommit({
      intent, candidates, days: [
        { day: 1, kind: 'visit', theme: 'Traditional Tokyo', items: [
          { candidateKey: 'temple', timeOfDay: 'morning', planningNote: 'Explore traditional architecture at a relaxed pace.', text: activityTexts[0] },
          { candidateKey: 'museum', timeOfDay: 'afternoon', planningNote: 'Explore indoor cultural exhibits.', text: activityTexts[1] }] },
        { day: 2, kind: 'visit', theme: 'Culture and gardens', items: [
          { candidateKey: 'garden', timeOfDay: 'morning', planningNote: 'Enjoy a relaxed garden walk.', text: activityTexts[2] }] }
      ], text: { reply: fullInput.text.reply, overview: fullInput.text.overview,
        days: fullInput.text.days },
      candidates: candidates.map(candidate => ({ ...candidate, sourceRefs: candidate.sourceRefs }))
    }, { trip })
    adapterMs = performance.now() - adaptStart
    observation.adapterMs = adapterMs
  }
  const context = { ...scope, requestId: `d6-replay:${pairIndex}:${style}`, trips, artifacts, conversations,
    resolvedLocations: new Map(), resolvedLocationKeys: new Set(), goalRepository: goals, goalRunRepository: runs,
    goalVerifiers: verifierModule.createDefaultGoalVerifierRegistry(), isGenerationCurrent: () => true,
    tripContextSnapshot: trip, requireGuideFinalization: true }
  const tool = commitModule.createCommitGuideTool({ evidenceStore: evidence, locale: 'en', memoryEnabled: true })
  const runStart = performance.now()
  observation.stage = 'commit_execution'
  const result = await tool.execute(tool.inputSchema.parse(input), context, new AbortController().signal)
  const executeMs = performance.now() - runStart
  observation.executeMs = executeMs
  const artifact = result?.artifact?.id ? await artifacts.get(result.artifact.id) : undefined
  const payload = artifact && guideModule.travelGuideArtifactPayloadSchema.parse(artifact.payload)
  const publication = artifact && publicationModule.publicationFor(artifact)
  const semantic = semanticGuide(payload, publication)
  return { style, pairIndex, warmup, accepted: result?.status === 'accepted' && result?.completion?.status === 'satisfied',
    error: result?.status === 'accepted' ? null : JSON.stringify(result).slice(0, 500),
    adapterMs, executeMs, totalMs: performance.now() - started, methodCalls: counts,
    artifactCount: (await artifacts.listForTrip(ids.trip)).length, tripCount: 1, semantic,
    modelCalls: 0, externalCalls: 0 }
}

const rows = []
const failures = []
for (let index = 0; index <= 10; index++) {
  for (const style of ['baseline', 'd6']) {
    try {
      const row = await runOne(style === 'baseline' ? baselineDist : currentDist, style, index, index === 0)
      rows.push(row)
      if (!row.accepted) failures.push({ pairIndex: index, style, error: row.error })
    } catch (error) {
      const observation = observations.get(`${style}:${index}`)
      const row = { style, pairIndex: index, warmup: index === 0, accepted: false, error: String(error?.stack ?? error).slice(0, 1500),
        stage: observation?.stage ?? 'module_import', adapterMs: observation?.adapterMs ?? null,
        methodCalls: observation?.counts ?? {}, modelCalls: 0, externalCalls: 0 }
      rows.push(row); failures.push(row)
    }
  }
}

const baselineSamples = rows.filter(row => row.style === 'baseline' && !row.warmup && row.accepted)
const d6Samples = rows.filter(row => row.style === 'd6' && !row.warmup && row.accepted)
const fingerprints = {
  baselineSource: await treeFingerprint(resolve(baselineDist, '..', 'src')),
  d6Source: await treeFingerprint(resolve(currentDist, '..', 'src')),
  baselineDist: await treeFingerprint(baselineDist),
  d6Dist: await treeFingerprint(currentDist)
}
const semanticMatches = baselineSamples.length === 10 && d6Samples.length === 10
  && baselineSamples.every((row, index) => JSON.stringify(row.semantic) === JSON.stringify(d6Samples[index]?.semantic))
const summary = {
  mode: 'offline-fixed-replay', baselineDist, currentDist, fixedScenario: 'Tokyo two days, three distinct visits, one synthetic search snippet',
  baselineSourceCommit: 'f2ec6c1f75000d368d4d83b7ae6428c17dea3e0c', fingerprints,
  warmupsPerVersion: 1, pairedSamples: 10, modelCalls: 0, externalCalls: 0,
  acceptedSamples: { baseline: baselineSamples.length, d6: d6Samples.length }, semanticMatches,
  p50: { baselineExecuteMs: p50(baselineSamples.map(row => row.executeMs)), d6AdapterMs: p50(d6Samples.map(row => row.adapterMs)),
    d6ExecuteMs: p50(d6Samples.map(row => row.executeMs)), baselineTotalMs: p50(baselineSamples.map(row => row.totalMs)),
    d6TotalMs: p50(d6Samples.map(row => row.totalMs)) }, failures, rows
}
const path = resolve(outputDir, `fixed-replay-${new Date().toISOString().replaceAll(':', '-')}.json`)
await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
const { rows: _rows, ...concise } = summary
process.stdout.write(`${JSON.stringify({ report: path, ...concise }, null, 2)}\n`)
if (failures.length || !semanticMatches) process.exitCode = 1
