import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.js'

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/flightor',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a-secure-test-secret-with-at-least-32-characters'
}

describe('parseEnv', () => {
  it('applies safe defaults without requiring provider credentials', () => {
    const env = parseEnv(validEnv)
    expect(env.PORT).toBe(3000)
    expect(env.OAG_SCHEDULES_KEY).toBe('')
    expect(env.SERPAPI_KEY).toBe('')
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
})
