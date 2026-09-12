import { describe, expect, it } from 'vitest'
import { parseEnv } from '../config/env.js'
import { issueAccessToken, verifyAccessToken } from './tokens.js'

function testEnv(secret: string) {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: secret
  })
}

describe('access tokens', () => {
  it('round-trips the internal and public user identity', async () => {
    const env = testEnv('test-secret-that-is-longer-than-thirty-two-characters')
    const token = await issueAccessToken({ userId: '42', publicId: '018f-public' }, env)
    await expect(verifyAccessToken(token, env)).resolves.toEqual({ userId: '42', publicId: '018f-public' })
  })

  it('rejects a token signed by a different environment', async () => {
    const first = testEnv('first-secret-that-is-longer-than-thirty-two-chars')
    const second = testEnv('second-secret-that-is-longer-than-thirty-two-char')
    const token = await issueAccessToken({ userId: '42', publicId: 'public' }, first)
    await expect(verifyAccessToken(token, second)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('rejects existing local test tokens after disabling local login or entering production', async () => {
    const env = { ...testEnv('local-token-test-secret-with-at-least-32-characters'), HOST: '127.0.0.1', LOCAL_LOGIN_ENABLED: true, LOCAL_LOGIN_KEY: 'local-token-test-key-with-at-least-32-characters' }
    const token = await issueAccessToken({ userId: '42', publicId: 'local-public', localTest: true }, env)
    await expect(verifyAccessToken(token, env)).resolves.toMatchObject({ userId: '42', localTest: true })
    for (const override of [{ LOCAL_LOGIN_ENABLED: false }, { NODE_ENV: 'production' as const }]) {
      await expect(verifyAccessToken(token, { ...env, ...override })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      await expect(issueAccessToken({ userId: '42', publicId: 'local-public', localTest: true }, { ...env, ...override })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    }
  })
})
