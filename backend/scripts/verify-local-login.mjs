import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { env } from '../dist/config/env.js'
import { db } from '../dist/db/index.js'
import { verifyAccessToken } from '../dist/auth/tokens.js'
import { rotateRefreshToken } from '../dist/auth/service.js'
import { sha256 } from '../dist/lib/crypto.js'

const database = new URL(env.DATABASE_URL)
if (env.NODE_ENV !== 'development' || !env.LOCAL_LOGIN_ENABLED || env.HOST !== '127.0.0.1'
  || database.pathname !== '/flightor_demo' || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname)) {
  throw new Error('Expected local test login on the dedicated flightor_demo development database')
}
const base = `http://127.0.0.1:${env.PORT}`
const checks = []
const sessionHashes = []
let tripId, ownerId, evidence
async function call(path, { method = 'GET', data, token, key } = {}) {
  const response = await fetch(base + path, {
    method, signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(key ? { 'x-local-login-key': key } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  })
  return { status: response.status, body: await response.json() }
}
function status(response, expected) {
  assert.equal(response.status, expected, `Unexpected status ${response.status}; error ${response.body.error?.code ?? 'none'}`)
}
try {
  status(await call('/v1/auth/local', { method: 'POST', data: {} }), 403)
  status(await call('/v1/auth/local', { method: 'POST', data: {}, key: 'wrong-key' }), 403)
  status(await call('/v1/auth/local', { method: 'POST', data: { user_id: '1' }, key: env.LOCAL_LOGIN_KEY }), 400)
  checks.push('missing/wrong key rejected', 'client-supplied identity rejected')

  const first = await call('/v1/auth/local', { method: 'POST', data: {}, key: env.LOCAL_LOGIN_KEY })
  status(first, 200)
  sessionHashes.push(sha256(first.body.refreshToken))
  const identity = await verifyAccessToken(first.body.accessToken, env)
  ownerId = identity.userId
  assert.equal(identity.localTest, true)
  for (const override of [{ LOCAL_LOGIN_ENABLED: false }, { NODE_ENV: 'production' }]) {
    await assert.rejects(verifyAccessToken(first.body.accessToken, { ...env, ...override }), error => error.code === 'UNAUTHORIZED')
    await assert.rejects(rotateRefreshToken({ db, env: { ...env, ...override } }, first.body.refreshToken), error => error.code === 'UNAUTHORIZED')
  }
  checks.push('access and refresh tokens rejected when local login is disabled or in production')
  const provider = await db.selectFrom('user_identities').select('provider')
    .where('user_id', '=', ownerId).where('provider', '=', 'local_test').executeTakeFirst()
  assert.equal(provider?.provider, 'local_test')
  checks.push('real PostgreSQL local_test identity and JWT session')
  status(await call('/v1/memory', { token: first.body.accessToken }), 200)

  const created = await call('/v1/trips', { method: 'POST', data: { title: `Local login verification ${randomUUID()}` }, token: first.body.accessToken })
  status(created, 201)
  tripId = created.body.trip.id
  status(await call('/v1/conversations', { method: 'POST', data: { trip_id: tripId }, token: first.body.accessToken }), 201)

  const refreshed = await call('/v1/auth/refresh', { method: 'POST', data: { refresh_token: first.body.refreshToken } })
  status(refreshed, 200)
  sessionHashes.push(sha256(refreshed.body.refreshToken))
  assert.equal(refreshed.body.user.id, first.body.user.id)
  assert.equal((await verifyAccessToken(refreshed.body.accessToken, env)).localTest, true)
  status(await call('/v1/auth/refresh', { method: 'POST', data: { refresh_token: first.body.refreshToken } }), 401)
  checks.push('refresh token rotates and old token cannot be reused')

  const repeated = await call('/v1/auth/local', { method: 'POST', data: {}, key: env.LOCAL_LOGIN_KEY })
  status(repeated, 200)
  sessionHashes.push(sha256(repeated.body.refreshToken))
  assert.equal(repeated.body.user.id, first.body.user.id)
  const restored = await call(`/v1/trips/${tripId}`, { token: repeated.body.accessToken })
  status(restored, 200)
  assert.equal(restored.body.trip.id, tripId)
  status(await call(`/v1/trips/${tripId}/workspace`, { token: repeated.body.accessToken }), 200)
  checks.push('stable account across sign-ins', 'Trip/conversation persistence and workspace restore')

  evidence = { checkedAt: new Date().toISOString(), mode: 'local_test_real_backend', status: 'passed', checks, userPublicId: first.body.user.id, temporaryDataCleanedOnExit: true, wechatExchangeVerified: false, deviceUIVerified: false }
} finally {
  // Only remove the fresh verification Trip and sessions created by this invocation.
  if (tripId && ownerId) await db.deleteFrom('trips').where('public_id', '=', tripId).where('user_id', '=', ownerId).execute()
  if (ownerId && sessionHashes.length) await db.deleteFrom('user_sessions').where('user_id', '=', ownerId).where('refresh_token_hash', 'in', sessionHashes).execute()
  await db.destroy()
}
const evidenceFile = new URL(`../.demo/local-login-${evidence.checkedAt.replace(/[:.]/g, '-')}.json`, import.meta.url)
await fs.writeFile(evidenceFile, JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 2))
