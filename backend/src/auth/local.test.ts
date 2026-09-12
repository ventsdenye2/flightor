import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { parseEnv } from '../config/env.js'
import { isAppError } from '../lib/errors.js'
import { authorizeLocalLogin } from './local.js'

const env = parseEnv({
  NODE_ENV: 'test', HOST: '127.0.0.1',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor_test', REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'local-auth-test-secret-with-at-least-32-characters',
  LOCAL_LOGIN_ENABLED: 'true', LOCAL_LOGIN_KEY: 'local-auth-test-key-with-at-least-32-characters'
})

describe('local test login transport authorization', () => {
  it('accepts only enabled, authenticated loopback connections', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(() => authorizeLocalLogin(env, address, env.LOCAL_LOGIN_KEY)).not.toThrow()
    }
    for (const address of [undefined, '192.168.1.5', '8.8.8.8']) {
      expect(() => authorizeLocalLogin(env, address, env.LOCAL_LOGIN_KEY)).toThrow('was rejected')
    }
    for (const key of [undefined, '', 'wrong', [env.LOCAL_LOGIN_KEY]]) {
      expect(() => authorizeLocalLogin(env, '127.0.0.1', key)).toThrow('was rejected')
    }
  })

  it('stays closed for production, default config and unsafe bindings even with the correct key', () => {
    for (const override of [{ NODE_ENV: 'production' as const }, { LOCAL_LOGIN_ENABLED: false }, { HOST: '0.0.0.0' }, { LOCAL_LOGIN_KEY: '' }]) {
      expect(() => authorizeLocalLogin({ ...env, ...override }, '127.0.0.1', env.LOCAL_LOGIN_KEY)).toThrow('not enabled')
    }
  })

  it('ignores spoofed forwarded IP headers and authorizes the real socket peer', async () => {
    const app = Fastify({ trustProxy: true })
    app.setErrorHandler((error, _request, reply) => reply.code(isAppError(error) ? error.statusCode : 500).send({ rejected: true }))
    app.post('/local', async request => {
      authorizeLocalLogin(env, request.raw.socket.remoteAddress, request.headers['x-local-login-key'])
      return { accepted: true }
    })
    try {
      const response = await app.inject({
        method: 'POST', url: '/local', remoteAddress: '192.168.1.5',
        headers: { 'x-forwarded-for': '127.0.0.1', 'x-local-login-key': env.LOCAL_LOGIN_KEY }
      })
      expect(response.statusCode).toBe(403)
    } finally { await app.close() }
  })
})
