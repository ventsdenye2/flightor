import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=')
  return [key, rest.join('=')]
}))
if (!args.snapshot) throw new Error('Use --snapshot=<directory>')
const root = path.resolve(args.snapshot)
const port = Number(args.port || 3012)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Replay port must be between 1024 and 65535')
const [manifestText, snapshotText] = await Promise.all([
  fs.readFile(path.join(root, 'manifest.json'), 'utf8'),
  fs.readFile(path.join(root, 'snapshot.json'), 'utf8')
])
const manifest = JSON.parse(manifestText)
const snapshot = JSON.parse(snapshotText)
const expected = manifest.files?.find(file => file.path === 'snapshot.json')?.sha256
const actual = createHash('sha256').update(snapshotText).digest('hex')
if (!expected || expected !== actual) throw new Error('SNAPSHOT_HASH_MISMATCH')
if (!snapshot?.trip?.id || !snapshot?.workspace?.trip || !Array.isArray(snapshot.artifacts)) {
  throw new Error('INVALID_SNAPSHOT_SHAPE')
}

const artifacts = new Map(snapshot.artifacts.map(artifact => [artifact.id, artifact]))
const tripId = snapshot.trip.id
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'authorization,content-type,x-local-login-key',
  'cache-control': 'no-store'
}
function send(response, status, body) {
  response.writeHead(status, { ...cors, 'content-type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(body)}\n`)
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
  if (request.method === 'OPTIONS') return send(response, 204, {})
  if (request.method === 'POST' && url.pathname === '/v1/auth/local') return send(response, 200, {
    accessToken: 'replay-access-token', refreshToken: 'replay-refresh-token',
    user: { id: 'replay-user', nickname: '真实快照回放', avatarUrl: '' }
  })
  if (request.method === 'GET' && url.pathname === '/health/ready') return send(response, 200, {
    status: 'ready', checks: { snapshot: 'verified', liveProviders: 'disabled' }
  })
  if (request.method === 'GET' && url.pathname === '/v1/trips') return send(response, 200, {
    trips: [snapshot.workspace.trip], nextCursor: null, replay: { capturedAt: snapshot.capturedAt }
  })
  if (request.method === 'GET' && url.pathname === `/v1/trips/${tripId}`) return send(response, 200, { trip: snapshot.trip })
  if (request.method === 'GET' && url.pathname === `/v1/trips/${tripId}/workspace`) return send(response, 200, snapshot.workspace)
  if (request.method === 'GET' && url.pathname === '/v1/memory') return send(response, 200, snapshot.memory)
  const artifactMatch = request.method === 'GET' && url.pathname.match(/^\/v1\/artifacts\/([0-9a-f-]{36})$/i)
  if (artifactMatch && artifacts.has(artifactMatch[1])) return send(response, 200, { artifact: artifacts.get(artifactMatch[1]) })
  return send(response, 409, { error: { code: 'REPLAY_MISS', message: 'This request is absent from the captured snapshot; live fallback is disabled.' } })
})
server.listen(port, '127.0.0.1', () => console.log(`FlightOR strict replay: http://127.0.0.1:${port}`))
