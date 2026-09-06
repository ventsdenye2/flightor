import type { AppEnv } from '../config/env.js'
import { AeroDataBoxProvider } from '../aviation/providers/aerodatabox.js'
import { OagAviationProvider } from '../aviation/providers/oag.js'
import { SerpApiFareProvider } from '../fares/providers/serpapi.js'
import { OagClient } from './oag/client.js'
import { OpenRouterClient } from './openrouter/client.js'
import { SerpApiClient } from './serpapi/client.js'

export function createProviders(env: AppEnv) {
  const oag = new OagClient(env)
  const serpapi = new SerpApiClient(env)
  return {
    oag,
    serpapi,
    openrouter: new OpenRouterClient(env),
    aviation: new AeroDataBoxProvider(env),
    oagAviation: new OagAviationProvider(oag),
    fares: new SerpApiFareProvider(serpapi)
  }
}

export type Providers = ReturnType<typeof createProviders>
