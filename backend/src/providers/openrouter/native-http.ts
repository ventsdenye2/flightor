import { AppError } from '../../lib/errors.js'
import type { NativeResearchReceipt } from '../../research-agent/native.js'

const MAX_ERROR_BODY_BYTES = 16_384
const MAX_HEADER_CHARACTERS = 512
const AUDIT_HEADERS = ['content-type', 'date', 'retry-after', 'x-request-id', 'x-openrouter-request-id', 'cf-ray'] as const
type HttpReceipt = NonNullable<NativeResearchReceipt['http']>

function redact(value: string, apiKey: string, truncated = false): string {
  const secrets = [...new Set([apiKey, encodeURIComponent(apiKey), JSON.stringify(apiKey).slice(1, -1)])].filter(Boolean)
  let result = value
  for (const secret of secrets) {
    result = result.split(secret).join('[REDACTED]')
    // A response can end at the byte cap halfway through an echoed credential.
    if (truncated) {
      for (let length = Math.min(secret.length - 1, result.length); length > 0; length--) {
        if (result.endsWith(secret.slice(0, length))) {
          result = `${result.slice(0, -length)}[REDACTED]`
          break
        }
      }
    }
  }
  return result
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>;,}]+/gi, '[REDACTED]')
    .replace(/((?:["']?)(?:authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*(?:"|$)|'[^'\r\n]*(?:'|$)|[^\r\n,;}]+)/gi, '$1"[REDACTED]"')
}

async function errorReceipt(response: Response, apiKey: string): Promise<HttpReceipt> {
  const headers: Record<string, string> = {}
  for (const name of AUDIT_HEADERS) {
    const value = response.headers.get(name)
    if (value !== null) headers[name] = redact(value, apiKey).slice(0, MAX_HEADER_CHARACTERS)
  }
  const chunks: Uint8Array[] = []
  let size = 0
  let bodyTruncated = false
  let bodyIncomplete = false
  const reader = response.body?.getReader()
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        const remaining = MAX_ERROR_BODY_BYTES - size
        chunks.push(chunk.value.slice(0, remaining))
        size += Math.min(remaining, chunk.value.length)
        if (chunk.value.length > remaining) {
          bodyTruncated = true
          void reader.cancel().catch(() => {})
          break
        }
      }
    } catch {
      // Headers and the received prefix still explain a failed HTTP response.
      bodyIncomplete = true
    } finally {
      reader.releaseLock()
    }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  const redacted = redact(new TextDecoder().decode(bytes), apiKey, bodyTruncated || bodyIncomplete)
  return { status: response.status, headers, body: redacted.slice(0, MAX_ERROR_BODY_BYTES), bodyTruncated: bodyTruncated || redacted.length > MAX_ERROR_BODY_BYTES, bodyIncomplete }
}

/** Native-only, single-attempt transport. HTTP failures retain evidence before normalization. */
export async function fetchNativeResearch(
  url: string, body: Record<string, unknown>, apiKey: string,
  options: { signal: AbortSignal; timeoutMs: number }
): Promise<{ ok: true; payload: unknown } | { ok: false; http: HttpReceipt }> {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = AbortSignal.any([options.signal, timeout])
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body), signal
    })
    if (!response.ok) return { ok: false, http: await errorReceipt(response, apiKey) }
    return { ok: true, payload: await response.json() }
  } catch {
    const cancelled = options.signal.aborted && !timeout.aborted
    throw new AppError(
      timeout.aborted ? 'PROVIDER_TIMEOUT' : cancelled ? 'PROVIDER_CANCELLED' : 'PROVIDER_UNAVAILABLE',
      `openrouter request ${timeout.aborted ? 'timed out' : cancelled ? 'was cancelled' : 'failed'}`, 502, { provider: 'openrouter' }
    )
  }
}
