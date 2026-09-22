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
  REDIS_ENABLED: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(86400).default(3600),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ADMIN_API_TOKEN: z.string().default(''),
  WX_APPID: z.string().default(''),
  WX_SECRET: z.string().default(''),
  LOCAL_LOGIN_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  LOCAL_LOGIN_KEY: z.string().default(''),
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
  PLACES_NOMINATIM_URL: optionalUrl.default(''),
  PLACES_USER_AGENT: z.string().trim().max(240).default(''),
  MAP_TILE_URL: z.string().max(500).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['{z}','{x}','{y}'].every(token=>value.includes(token))}catch{return false}},'HTTPS tile template required').default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  SERPAPI_BASE_URL: optionalUrl.default('https://serpapi.com/search.json'),
  OPENROUTER_API_KEY: z.string().default(''),
  OPENROUTER_BASE_URL: optionalUrl.default('https://openrouter.ai/api/v1'),
  OPENROUTER_MODEL: z.string().trim().min(1).default('deepseek/deepseek-v4-flash-0731'),
  PLANNER_MODEL: z.string().trim().default(''),
  PLANNER_LEAN_GOALS_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  RESEARCH_MODEL: z.string().trim().default(''),
  /** Default remains the established SerpApi + synthesis path. */
  NATIVE_RESEARCH_PROVIDER: z.enum(['serpapi', 'openrouter_native']).default('serpapi'),
  NATIVE_RESEARCH_MODEL: z.enum(['qwen/qwen3.8-flash', 'z-ai/glm-5.3-flash']).default('qwen/qwen3.8-flash'),
  /** Shared DB budget key; its amount is provisioned separately and never initialized by a request. */
  NATIVE_RESEARCH_BUDGET_ID: z.string().trim().max(160).default(''),
  NATIVE_RESEARCH_MAX_CALL_USD_MICROS: z.coerce.number().int().min(0).max(1_000_000_000_000).default(0),
  NATIVE_RESEARCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(95_000).default(95_000)
})

export type AppEnv = z.infer<typeof envSchema>

export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const names = result.error.issues.map(issue => issue.path.join('.')).join(', ')
    throw new Error(`Invalid backend environment variables: ${names}`)
  }
  if (result.data.NODE_ENV === 'production' && !result.data.REDIS_ENABLED) throw new Error('Redis cannot be disabled in production')
  if (result.data.LOCAL_LOGIN_ENABLED) {
    if (result.data.NODE_ENV === 'production') throw new Error('Local test login cannot be enabled in production')
    if (!['127.0.0.1', '::1'].includes(result.data.HOST)) throw new Error('Local test login requires a loopback HOST')
    if (result.data.LOCAL_LOGIN_KEY.length < 32) throw new Error('LOCAL_LOGIN_KEY must contain at least 32 characters')
  }
  return {
    ...result.data,
    PLANNER_MODEL: result.data.PLANNER_MODEL || result.data.OPENROUTER_MODEL,
    RESEARCH_MODEL: result.data.RESEARCH_MODEL || result.data.OPENROUTER_MODEL
  }
}

export const env = parseEnv()
