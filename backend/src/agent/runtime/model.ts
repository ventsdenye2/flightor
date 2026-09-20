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
  enabled?: boolean
  effort?: ChatReasoningEffort
  exclude?: boolean
}

export interface ChatOptions {
  responseFormat?: { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } }
  timeoutMs?: number
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
  observation?: ChatCompletionObservation
}

export interface ChatCompletionUsage {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  reasoningTokens: number | null
  cachedTokens: number | null
}

export interface ChatCompletionObservation {
  requestModel: string
  responseModel: string | null
  provider: string | null
  gateway: string
  finishReason: string | null
  usage: ChatCompletionUsage
  costUsdMicros: number | null
  configFingerprint: string
  routeFingerprint: string | null
  reasoning: ChatReasoning | null
  maxTokens: number | null
  temperature: number | null
  toolChoice: ChatToolChoice | null
  timeoutMs: number | null
}

export interface AgentModelClient {
  complete(messages: ChatMessage[], model?: string, options?: ChatOptions): Promise<ChatCompletion>
}
