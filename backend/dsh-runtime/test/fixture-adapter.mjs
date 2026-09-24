import { LlmAdapter } from '@deepseek-ai/dsh-llm'
export class FixtureAdapter extends LlmAdapter {
  calls = []
  constructor(script) { super(); this.script = [...script] }
  async resolveModel(provider, model) { return { provider, id: model, name: model } }
  async *stream(options) {
    this.calls.push(options)
    const entry = this.script.shift()
    if (!entry) throw new Error('Fixture script exhausted')
    if (entry.hang) {
      await new Promise((_, reject) => {
        if (options.signal.aborted) return reject(options.signal.reason)
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
      return
    }
    const block = entry.tool
      ? { type: 'tool-call', id: `call-${this.calls.length}`, name: entry.tool, arguments: JSON.stringify(entry.args ?? {}) }
      : { type: 'text', text: entry.text }
    yield { type: 'block-start', index: 0, blockType: block.type }
    if (entry.tool) yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
    else yield { type: 'text-delta', index: 0, text: block.text }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: entry.tool ? 'tool-calls' : 'stop' } }
  }
}
