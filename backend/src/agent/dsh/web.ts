import { z } from 'zod'
import { PublicResearchSourceReader } from '../../research-agent/source-reader.js'
import type { SerpApiClient } from '../../providers/serpapi/client.js'
import { AppError } from '../../lib/errors.js'
import type { DshEvidenceStore, DshFetchResult, DshSearchResult } from './evidence.js'

export const DSH_WEB_TOOLS = [
  { name: 'web_search', description: 'Search original sources. One query per call.', rawSchema: { type: 'object', properties: { queries: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1 } }, required: ['queries'], additionalProperties: false } },
  { name: 'web_fetch', description: 'Fetch a source page through the safe public HTTPS reader.', rawSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false } },
]
export interface DshWebDependencies {
  provider: 'serpapi-raw' | 'deepseek-official'
  serpapi: Pick<SerpApiClient, 'searchOrganic'>
  reader?: PublicResearchSourceReader
}
export async function executeDshWeb(name: string, args: unknown, callId: string, signal: AbortSignal, deps: DshWebDependencies, evidence: DshEvidenceStore) {
  signal.throwIfAborted()
  if (name === '__web_search') {
    if (deps.provider !== 'serpapi-raw') throw new AppError('DSH_SEARCH_ROUTE_MISMATCH', 'Raw search is disabled for this profile', 403)
    const input = z.object({ query: z.string().trim().min(1).max(500), maxResults: z.number().int().min(1).max(6).optional() }).strict().parse(args)
    const sources = await deps.serpapi.searchOrganic({ query: input.query, limit: input.maxResults ?? 6 }, signal)
    return { sources: sources.map(({ domain: _domain, ...source }) => source), truncated: sources.length >= (input.maxResults ?? 6) }
  }
  if (name === '__web_fetch') {
    const input = z.object({ url: z.url().max(500) }).strict().parse(args)
    try {
      const page = await (deps.reader ?? new PublicResearchSourceReader()).read(input.url, { signal })
      return { url: page.url, statusCode: page.statusCode, body: { kind: 'text', content: page.text }, truncated: page.truncated }
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode !== undefined) return { url: input.url, statusCode, body: { kind: 'text', content: '' }, truncated: false }
      throw error
    }
  }
  if (name === '__record_web') {
    const input = z.object({ tool: z.enum(['web_search', 'web_fetch']), args: z.record(z.string(), z.unknown()), value: z.record(z.string(), z.unknown()) }).strict().parse(args)
    return input.tool === 'web_search' ? evidence.recordSearch(input.value as DshSearchResult, deps.provider, callId)
      : evidence.recordFetch(z.string().parse(input.args.url), input.value as DshFetchResult, 'flightor-safe-fetch', callId)
  }
  throw new AppError('DSH_TOOL_DENIED', 'Internal operation is not allowed', 403)
}
