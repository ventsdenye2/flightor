import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

// These suites create isolated schemas and require an explicit TEST_DATABASE_URL.
export const postgresTestFiles = [
  'src/**/postgres.integration.test.ts',
  'src/**/*-postgres.integration.test.ts',
  'src/db/cloud-state.integration.test.ts',
]

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...postgresTestFiles],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    // App modules validate environment at import time. Keep unit collection
    // independent of local .env files and paid-provider credentials.
    env: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/flightor_offline',
      REDIS_URL: 'redis://127.0.0.1:1',
      REDIS_ENABLED: 'false',
      JWT_SECRET: 'flightor-offline-test-secret-at-least-32-characters',
      LOCAL_LOGIN_ENABLED: 'false',
      LOCAL_LOGIN_KEY: '',
      WX_APPID: '',
      WX_SECRET: '',
      ADMIN_API_TOKEN: '',
      AERODATABOX_API_KEY: '',
      OAG_FLIGHT_INFO_KEY: '',
      OAG_CONNECTIONS_KEY: '',
      OAG_SCHEDULES_KEY: '',
      OAG_MASTER_DATA_KEY: '',
      SERPAPI_KEY: '',
      OPENROUTER_API_KEY: '',
      NATIVE_RESEARCH_PROVIDER: 'serpapi',
      NATIVE_RESEARCH_BUDGET_ID: '',
      NATIVE_RESEARCH_MAX_CALL_USD_MICROS: '0',
    },
  },
})
