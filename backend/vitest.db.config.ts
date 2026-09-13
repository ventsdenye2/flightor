import { configDefaults, defineConfig } from 'vitest/config'
import offlineConfig, { postgresTestFiles } from './vitest.config.js'

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL explicitly before running PostgreSQL suites')
}

export default defineConfig({
  ...offlineConfig,
  test: {
    ...offlineConfig.test,
    include: postgresTestFiles,
    exclude: configDefaults.exclude,
  },
})
