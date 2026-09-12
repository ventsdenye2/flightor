import type { NativeResearchReceipt, NativeResearchTransport } from '../../research-agent/native.js'

export interface OpenRouterNativeResearchClient {
  completeNativeResearch(body: Record<string, unknown>, options: { signal: AbortSignal; timeoutMs: number }): Promise<NativeResearchReceipt>
}

/** Thin transport: no retries, no artifact writes, and no budget decisions. */
export class OpenRouterNativeResearchTransport implements NativeResearchTransport {
  constructor(private readonly client: OpenRouterNativeResearchClient) {}
  complete(input: { body: Record<string, unknown>; signal: AbortSignal; timeoutMs: number }): Promise<NativeResearchReceipt> {
    return this.client.completeNativeResearch(input.body, { signal: input.signal, timeoutMs: input.timeoutMs })
  }
}
