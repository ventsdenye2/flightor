import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))
const tripId = args.trip
const baseUrl = (args.api || 'http://127.0.0.1:3011').replace(/\/$/, '')
if (!tripId || !/^[0-9a-f-]{36}$/i.test(tripId)) throw new Error('Use --trip=<uuid>')
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) throw new Error('Snapshot export only accepts a loopback API')
if (!process.env.LOCAL_LOGIN_KEY) throw new Error('LOCAL_LOGIN_KEY is required')

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(15_000), ...options })
  const body = await response.json()
  if (!response.ok) throw new Error(`${route} returned ${response.status}: ${body?.error?.code || 'unknown'}`)
  return body
}

const login = await request('/v1/auth/local', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-local-login-key': process.env.LOCAL_LOGIN_KEY }, body: '{}'
})
const headers = { authorization: `Bearer ${login.accessToken}` }
const [tripResponse, workspace, memory] = await Promise.all([
  request(`/v1/trips/${tripId}`, { headers }),
  request(`/v1/trips/${tripId}/workspace`, { headers }),
  request('/v1/memory', { headers })
])
const artifacts = await Promise.all(workspace.artifactRefs.map(async ref =>
  (await request(`/v1/artifacts/${ref.id}`, { headers })).artifact))

const uuidMap = new Map()
function pseudonym(value) {
  if (!uuidMap.has(value)) {
    const hex = createHash('sha256').update(`flight-first:${value}`).digest('hex')
    uuidMap.set(value, `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`)
  }
  return uuidMap.get(value)
}

const droppedKeys = /^(authorization|cookie|accessToken|refreshToken|token|secret|apiKey|bookingUrl)$/i
function sanitize(value) {
  if (typeof value === 'string') return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? pseudonym(value) : value
  if (Array.isArray(value)) return value.map(sanitize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => droppedKeys.test(key) ? [] : [[key, sanitize(item)]]))
}

const selected = workspace.trip.selectedFlight
const flightArtifact = selected ? artifacts.find(artifact => artifact.id === selected.artifactId) : undefined
const offers = flightArtifact?.payload?.offers ?? []
const comparison = offers.map(offer => ({
  offerId: offer.id,
  route: offer.segments.map(segment => segment.origin).concat(offer.segments.at(-1)?.destination ?? []).join(' -> '),
  amount: offer.totalAmount, currency: offer.currency,
  totalDurationMinutes: offer.totalDurationMinutes ?? null,
  transferType: offer.transferType,
  layovers: offer.layovers ?? [],
  selected: selected?.kind === 'offer' && selected.offerId === offer.id
}))
const guideRefs = workspace.artifactRefs.filter(ref => ref.type === 'travel_guide')
const latestAssistant = [...workspace.messages].reverse().find(message => message.role === 'assistant')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: repoRoot }).trim()
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: repoRoot }).trim().length > 0
const exportedAt = new Date().toISOString()
const snapshot = sanitize({
  schemaVersion: 1,
  mode: 'live-captured-snapshot',
  capturedAt: exportedAt,
  trip: tripResponse.trip,
  workspace,
  artifacts,
  memory,
  comparison,
  acceptance: {
    liveFlightSearchCount: 1,
    normalizedOfferCount: offers.length,
    selectedFlight: selected ?? null,
    travelGuideArtifactCount: guideRefs.length,
    latestPlannerDelivery: latestAssistant?.delivery ?? null,
    latestPlannerReply: latestAssistant?.content ?? null,
    rawProviderResponse: { available: false, reason: 'The fare adapter did not persist the supplier HTTP body at capture time.' }
  }
})

const outputDir = path.resolve(args.out || `.demo/flight-first-${exportedAt.replace(/[:.]/g, '-')}`)
await fs.mkdir(outputDir, { recursive: true })
const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`
await fs.writeFile(path.join(outputDir, 'snapshot.json'), snapshotText)
const snapshotHash = createHash('sha256').update(snapshotText).digest('hex')
const manifest = {
  schemaVersion: 1,
  capturedAt: exportedAt,
  source: { mode: 'live', api: 'loopback', codeSha: sha, dirty },
  files: [{ path: 'snapshot.json', bytes: Buffer.byteLength(snapshotText), sha256: snapshotHash }],
  coverage: {
    query: Boolean(flightArtifact?.payload?.query),
    normalizedOffers: offers.length,
    comparison: comparison.length,
    persistedSelection: Boolean(selected),
    layovers: comparison.flatMap(value => value.layovers).length,
    travelGuide: guideRefs.length,
    workspace: true,
    rawProviderResponse: false
  },
  replayPolicy: { strict: true, liveFallback: false, unknownRequest: 'REPLAY_MISS' }
}
await fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({ outputDir, offerCount: offers.length, guideCount: guideRefs.length, snapshotHash, dirty }, null, 2))
