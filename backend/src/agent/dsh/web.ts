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
      const page = await (deps.reader ?? new PublicResearchSourceReader()).read(input.url, { signal, rejectChallengePage: true })
      return { url: page.url, statusCode: page.statusCode, body: { kind: 'text', content: page.text }, truncated: page.truncated }
    } catch (error) {
      signal.throwIfAborted()
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode !== undefined) return { url: input.url, statusCode, body: { kind: 'text', content: '' }, truncated: false }
      const known = new Set(['SOURCE_TIMEOUT', 'SOURCE_CANCELLED', 'SOURCE_URL_INVALID', 'SOURCE_URL_REJECTED', 'SOURCE_HOST_REJECTED',
        'SOURCE_DNS_REJECTED', 'SOURCE_ENCODING_REJECTED', 'SOURCE_CONTENT_TYPE_REJECTED', 'SOURCE_BODY_LIMIT', 'SOURCE_CHALLENGE_REJECTED'])
      const name = error instanceof Error ? error.name : ''
      const code = known.has(name) ? name : 'SOURCE_FETCH_FAILED'
      return { error: { code, hint: code === 'SOURCE_CHALLENGE_REJECTED'
        ? 'The source returned an access challenge, not page content. Use another retrieved source; this fetch supplies no evidence.'
        : code === 'SOURCE_TIMEOUT'
        ? 'The source fetch timed out. Use another retrieved source; this failed fetch supplies no evidence.'
        : 'The source could not be safely retrieved. Use another retrieved source; this failed fetch supplies no evidence.' } }
    }
  }
  if (name === '__record_web') {
    const input = z.object({ tool: z.enum(['web_search', 'web_fetch']), args: z.record(z.string(), z.unknown()), value: z.record(z.string(), z.unknown()) }).strict().parse(args)
    return input.tool === 'web_search' ? evidence.recordSearch(input.value as DshSearchResult, deps.provider, callId)
      : evidence.recordFetch(z.string().parse(input.args.url), input.value as DshFetchResult, 'flightor-safe-fetch', callId)
  }
  throw new AppError('DSH_TOOL_DENIED', 'Internal operation is not allowed', 403)
}
