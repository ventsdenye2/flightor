import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.js'

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-secure-test-secret-with-at-least-32-characters'
}

describe('parseEnv', () => {
  it('allows explicitly disabling the cache only outside production', () => {
    expect(parseEnv({ ...validEnv, REDIS_ENABLED: 'false' }).REDIS_ENABLED).toBe(false)
    expect(() => parseEnv({ ...validEnv, NODE_ENV: 'production', REDIS_ENABLED: 'false' })).toThrow('Redis cannot be disabled')
  })
  it('applies safe defaults without requiring provider credentials', () => {
    const env = parseEnv(validEnv)
    expect(env.PORT).toBe(3000)
    expect(env.AERODATABOX_API_KEY).toBe('')
    expect(env.OAG_SCHEDULES_KEY).toBe('')
    expect(env.SERPAPI_KEY).toBe('')
    expect(env.LOCAL_LOGIN_ENABLED).toBe(false)
    expect(env.LOCAL_LOGIN_KEY).toBe('')
    expect(env.OPENROUTER_MODEL).toBe('deepseek/deepseek-v4-flash-0731')
    expect(env.PLANNER_MODEL).toBe(env.OPENROUTER_MODEL)
    expect(env.RESEARCH_MODEL).toBe(env.OPENROUTER_MODEL)
  })

  it('keeps an explicitly configured model override', () => {
    const env = parseEnv({
      ...validEnv,
      OPENROUTER_MODEL: 'provider/custom-model',
      PLANNER_MODEL: 'provider/planner-model',
      RESEARCH_MODEL: 'provider/research-model'
    })
    expect(env.OPENROUTER_MODEL).toBe('provider/custom-model')
    expect(env.PLANNER_MODEL).toBe('provider/planner-model')
    expect(env.RESEARCH_MODEL).toBe('provider/research-model')
  })

  it('reports invalid variable names without including secret values', () => {
    const exposed = 'do-not-repeat-this-value'
    expect(() => parseEnv({ ...validEnv, JWT_SECRET: exposed })).toThrow(/JWT_SECRET/)
    try {
      parseEnv({ ...validEnv, JWT_SECRET: exposed })
    } catch (error) {
      expect(String(error)).not.toContain(exposed)
    }
  })

  it('requires an explicit non-production loopback configuration for test login', () => {
    const configured = { ...validEnv, HOST: '127.0.0.1', LOCAL_LOGIN_ENABLED: 'true', LOCAL_LOGIN_KEY: 'a-local-test-key-with-at-least-32-characters' }
    expect(parseEnv(configured).LOCAL_LOGIN_ENABLED).toBe(true)
    expect(() => parseEnv({ ...configured, NODE_ENV: 'production' })).toThrow('cannot be enabled in production')
    expect(() => parseEnv({ ...configured, HOST: '0.0.0.0' })).toThrow('loopback HOST')
    expect(() => parseEnv({ ...configured, LOCAL_LOGIN_KEY: '' })).toThrow('LOCAL_LOGIN_KEY')
  })
})
