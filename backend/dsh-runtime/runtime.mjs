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
export async function createRuntime({ root, adapter, provider = 'fixture', persona = '', tools = [], execute }) {
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
    return ctx
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
