import type { OpenRouterClient } from '../providers/openrouter/client.js'
import {
  convergeRoutes,
  parseDirective,
  searchRoutes
} from './engine.js'
import type { DirectiveParseResult, RoutePick } from './engine.js'
import { parseDirectiveSmart } from './llm.js'
import type { RoutePlannerChatClient } from './llm.js'

export interface RoutePlanResult extends DirectiveParseResult {
  routes: RoutePick[]
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function planRoute(
  text: string,
  today: string,
  client: RoutePlannerChatClient | OpenRouterClient | undefined
): Promise<RoutePlanResult> {
  const parsed = await parseDirectiveSmart(client, text, today)
  if (parsed.missing.length > 0 || parsed.conflicts.length > 0) {
    return { ...parsed, routes: [] }
  }
  return { ...parsed, routes: convergeRoutes(searchRoutes(parsed.slots)) }
}

export function planRouteWithRules(text: string, today: string): RoutePlanResult {
  const parsed = parseDirective(text, today)
  if (parsed.missing.length > 0 || parsed.conflicts.length > 0) {
    return { ...parsed, source: 'rules', warnings: [], routes: [] }
  }
  return { ...parsed, source: 'rules', warnings: [], routes: convergeRoutes(searchRoutes(parsed.slots)) }
}
