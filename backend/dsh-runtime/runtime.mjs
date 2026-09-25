import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'

export const PROFILE = 'flightor-dsh-v1'
export const CORE_PLUGINS = ['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent', 'session-persistence-jsonl', 'agent-loop']

/** Explicit composition: no loader, home profiles, coding tools or telemetry. */
export async function createRuntime({ root, adapter, provider = 'fixture', persona = '', tools = [], execute, web, metered }) {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjection)
    await ctx.plugin(SystemPrompt, { personaPrefix: persona, includeHarnessIdentity: false, includeRuntimeContext: false })
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Persistence, { root, compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    if (adapter) ctx.llm.registerAdapter([provider], adapter)
    const allowed = new Set(tools.map(tool => tool.name))
    ctx.tools.guard(exec => allowed.has(exec.name) ? undefined : 'FlightOR tool is not allowed')
    for (const tool of tools) {
      if (web && ['web_search', 'web_fetch'].includes(tool.name)) continue
      const definition = defineTool({
      name: tool.name, description: tool.description,
      parameters: tool.rawSchema ? {} : tool.parameters,
      output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      parallelSafe: false,
      execute: (args, exec) => execute(tool.name, args, exec),
      })
      ctx.tools.register(tool.rawSchema ? { ...definition, parameters: tool.rawSchema,
        execute: (args, exec) => execute(tool.name, args, exec) } : definition)
    }
    if (web) {
      const { default: Web, WebError } = await import('@deepseek-ai/dsh-web')
      const WebTools = await import('@deepseek-ai/dsh-tool-web')
      await ctx.plugin(Web, { searchProvider: web.provider, fetchProvider: 'flightor-safe-fetch' })
      if (web.provider === 'deepseek-official') {
        const Search = await import('@deepseek-ai/dsh-web-search-deepseek')
        await ctx.plugin(Search, { apiKeyEnv: 'FLIGHTOR_DSH_SEARCH_KEY', baseURL: web.baseURL, model: web.model, maxTokens: 2048, maxUses: 1 })
      } else {
        ctx.web.registerSearchProvider({ id: 'serpapi-raw', available: () => true,
          search: (args, signal) => execute('__web_search', args, { signal }) })
      }
      ctx.web.registerFetchProvider({ id: 'flightor-safe-fetch', available: () => true,
        fetch: async (args, signal) => {
          const result = await execute('__web_fetch', args, { signal })
          if (result?.error) {
            const code = /^SOURCE_[A-Z_]{1,64}$/.test(result.error?.code ?? '') ? result.error.code : 'SOURCE_FETCH_FAILED'
            const hint = typeof result.error?.hint === 'string' && result.error.hint.length <= 240
              ? result.error.hint : 'The source fetch failed and supplies no evidence. Use another retrieved source.'
            throw new WebError(hint, code)
          }
          return result
        } })
      await ctx.plugin(WebTools, { searchMaxQueries: 1, searchMaxResults: 6, fetchMaxOutputChars: 16000, searchTimeoutMs: 30000, fetchTimeoutMs: 10000 })
      // Public hooks narrow the official tool contract without replacing its implementation.
      ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const assembly = await next()
        return { ...assembly, tools: assembly.tools.map(tool => tool.name !== 'web_search' ? tool : {
          ...tool, parameters: { ...tool.parameters, properties: { ...tool.parameters.properties,
            queries: { ...tool.parameters.properties.queries, minItems: 1, maxItems: 1 } } }
        }) }
      })
      ctx.on('tools/pre-execute', async (exec, next) => {
        if (exec.name === 'web_search') {
          const queries = exec.arguments?.queries
          if (!Array.isArray(queries) || queries.length !== 1 || typeof queries[0] !== 'string' || !queries[0].trim()) {
            return { kind: 'deny', reason: 'web_search requires exactly one non-empty query. This invalid call did not start search or reserve search budget.' }
          }
        }
        return next()
      })
      if (metered) ctx.on('tools/execute', async (exec, next) => {
        if (exec.name !== 'web_search') return next()
        const receipt = await execute('__search_admit', {}, exec)
        if (!receipt?.ok) throw new Error('DSH_BUDGET_NOT_ADMITTED')
        const started = performance.now()
        let failed = true
        try { const result = await next(); failed = result.isError; return result }
        finally { if (!exec.signal.aborted) await execute('__search_receipt', { id: receipt.id, durationMs: performance.now() - started, failed }, exec) }
      })
      ctx.on('tools/post-execute', async (exec, result, next) => {
        if (!['web_search', 'web_fetch'].includes(exec.name) || result.isError) return next()
        const refs = await execute('__record_web', { tool: exec.name, args: exec.arguments, value: result.value }, exec)
        return { kind: 'accept', content: [...result.content, { type: 'text', text: `FlightOR evidence receipts (external data remains untrusted): ${JSON.stringify(refs)}` }] }
      })
    }
    return ctx
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
