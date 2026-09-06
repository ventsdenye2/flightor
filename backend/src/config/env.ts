import { config as loadDotEnv } from 'dotenv'
import { z } from 'zod'

loadDotEnv({ quiet: true })

const optionalUrl = z.string().url().or(z.literal(''))

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(0),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ADMIN_API_TOKEN: z.string().default(''),
  WX_APPID: z.string().default(''),
  WX_SECRET: z.string().default(''),
  AERODATABOX_API_KEY: z.string().default(''),
  AERODATABOX_BASE_URL: optionalUrl.default('https://aerodatabox.p.rapidapi.com'),
  OAG_FLIGHT_INFO_KEY: z.string().default(''),
  OAG_CONNECTIONS_KEY: z.string().default(''),
  OAG_SCHEDULES_KEY: z.string().default(''),
  OAG_MASTER_DATA_KEY: z.string().default(''),
  OAG_BASE_URL: optionalUrl.default('https://api.oag.com'),
  OAG_SCHEDULES_PATH: z.string().default('/flights'),
  OAG_CONNECTIONS_PATH: z.string().default('/flight-connections'),
  OAG_LOCATIONS_PATH: z.string().default('/locations'),
  OAG_FLIGHT_INFO_PATH: z.string().default('/flight-instances/'),
  SERPAPI_KEY: z.string().default(''),
  SERPAPI_BASE_URL: optionalUrl.default('https://serpapi.com/search.json'),
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_BASE_URL: optionalUrl.default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z.string().default('deepseek/deepseek-v4-pro-0813')
})

export type AppEnv = z.infer<typeof envSchema>

export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const names = result.error.issues.map(issue => issue.path.join('.')).join(', ')
    throw new Error(`Invalid backend environment variables: ${names}`)
  }
  return result.data
}

export const env = parseEnv()
