import type { AppEnv } from '../config/env.js'
import { OagClient } from './oag/client.js'
import { OpenRouterClient } from './openrouter/client.js'
import { SerpApiClient } from './serpapi/client.js'

export function createProviders(env: AppEnv) {
  return {
    oag: new OagClient(env),
    serpapi: new SerpApiClient(env),
    openrouter: new OpenRouterClient(env)
  }
}

export type Providers = ReturnType<typeof createProviders>
