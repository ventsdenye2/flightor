import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { EnterpriseTokens } from '../src/enterprise-tokens.mjs'
import { dataRoot } from '../src/paths.mjs'
const jwt = (use, exp) => 'header.' + Buffer.from(JSON.stringify({ token_use: use, exp })).toString('base64url') + '.signature'

test('refresh coalesces, preserves refresh token and unrelated env, never caches credentials', async () => {
  const root = await fs.mkdtemp(path.join(dataRoot, 'token-test-')), file = path.join(root, '.env')
  const env = { WIKIMEDIA_ENTERPRISE_USERNAME: 'TestUser', WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN: jwt('id', 1), WIKIMEDIA_ENTERPRISE_REFRESH_TOKEN: 'test-refresh' }
  let calls = 0
  await fs.writeFile(file, 'UNRELATED_SETTING=keep\n')
  const tokens = new EnterpriseTokens({ env, file, now: () => 100000, http: { json: async (url, options) => {
    calls++; assert.equal(options.cache, false); assert.equal(url.includes('test-refresh'), false)
    assert.equal(JSON.parse(options.body).username, 'testuser')
    return { access_token: jwt('access', 10000), id_token: jwt('id', 10000), expires_in: 9900 }
  } } })
  try {
    const [a, b] = await Promise.all([tokens.getAccessToken(), tokens.getAccessToken()])
    assert.equal(a, b); assert.equal(calls, 1); assert.equal(env.WIKIMEDIA_ENTERPRISE_REFRESH_TOKEN, 'test-refresh')
    assert.equal(await tokens.getAccessToken(), a); assert.equal(calls, 1)
    const saved = await fs.readFile(file, 'utf8')
    assert.match(saved, /UNRELATED_SETTING=keep/); assert.match(saved, /WIKIMEDIA_ENTERPRISE_ID_TOKEN=/)
    await tokens.getAccessToken({ forceRefresh: true }); assert.equal(calls, 2)
  } finally { await fs.rm(root, { recursive: true }) }
})

test('wrong token type and expired token without refresh are explicit configuration errors', async () => {
  await assert.rejects(new EnterpriseTokens({ env: { WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN: jwt('id', 1) }, file: null }).getAccessToken(), /id_token/)
  await assert.rejects(new EnterpriseTokens({ env: { WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN: jwt('access', 1) }, file: null }).getAccessToken(), /过期/)
  assert.equal(await new EnterpriseTokens({ env: {}, file: null }).getAccessToken(), undefined)
})
