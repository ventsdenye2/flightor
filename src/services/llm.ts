// src/services/llm.ts — OpenRouter 直连通道（小程序端）
// 密钥来源：构建时注入的 OPENROUTER_KEY（openrouter.txt，gitignored）
// 说明：开发/体验版直连（urlCheck 已关）；正式上线改走云函数（request 合法域名限制）
import Taro from '@tarojs/taro'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** 与云函数侧保持一致的默认模型 */
export const LLM_MODEL = 'openai/gpt-5.6-luna'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 是否具备直连条件（key 已注入） */
export function hasLlmKey(): boolean {
  return typeof OPENROUTER_KEY === 'string' && OPENROUTER_KEY.length > 0
}

/** 单次对话补全，返回 content 文本；强制 JSON 输出 */
export async function chatCompletion(
  messages: LlmMessage[],
  opts?: { model?: string; temperature?: number; maxTokens?: number }
): Promise<string> {
  const res = await Taro.request<{
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }>({
    url: OPENROUTER_URL,
    method: 'POST',
    header: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'content-type': 'application/json'
    },
    data: {
      model: opts?.model ?? LLM_MODEL,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 800,
      response_format: { type: 'json_object' }
    },
    timeout: 60000
  })

  if (res.statusCode !== 200) {
    throw new Error(`openrouter ${res.statusCode}: ${res.data?.error?.message ?? ''}`)
  }
  const content = res.data?.choices?.[0]?.message?.content
  if (!content) throw new Error('empty LLM response')
  return content
}

/** 从模型输出中提取 JSON（容忍围栏/前后杂质） */
export function extractJson<T>(text: string): T {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON in response')
  return JSON.parse(text.slice(start, end + 1)) as T
}
