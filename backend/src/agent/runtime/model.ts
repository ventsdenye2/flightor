export interface FunctionToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: FunctionToolCall[] }
  | { role: 'tool'; tool_call_id: string; name?: string; content: string }

export interface ChatToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ChatToolChoice = 'auto' | 'none' | 'required' | {
  type: 'function'
  function: { name: string }
}

export type ChatReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ChatReasoning {
  effort?: ChatReasoningEffort
  exclude?: boolean
}

export interface ChatOptions {
  maxTokens?: number
  temperature?: number
  reasoning?: ChatReasoning
  tools?: ChatToolDefinition[]
  toolChoice?: ChatToolChoice
  signal?: AbortSignal
}

export interface ChatCompletion {
  message: Extract<ChatMessage, { role: 'assistant' }>
  finishReason?: string
}

export interface AgentModelClient {
  complete(messages: ChatMessage[], model?: string, options?: ChatOptions): Promise<ChatCompletion>
}
