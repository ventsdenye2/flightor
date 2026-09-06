import { AppError } from './errors.js'

export interface FetchJsonOptions {
  timeoutMs?: number
  provider: string
  signal?: AbortSignal
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  options: FetchJsonOptions
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const callerSignal = options.signal ?? init.signal ?? undefined
  const abortFromCaller = () => controller.abort(callerSignal?.reason)
  if (callerSignal) {
    if (callerSignal.aborted) abortFromCaller()
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true })
  }
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const payload = await response.json().catch(() => ({})) as T & { error?: unknown; message?: unknown }
    if (!response.ok) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `${options.provider} returned HTTP ${response.status}`,
        502,
        { provider: options.provider, status: response.status }
      )
    }
    return payload
  } catch (error) {
    if (error instanceof AppError) throw error
    const cancelled = callerSignal?.aborted === true && !timedOut
    throw new AppError(
      timedOut ? 'PROVIDER_TIMEOUT' : cancelled ? 'PROVIDER_CANCELLED' : 'PROVIDER_UNAVAILABLE',
      `${options.provider} request ${timedOut ? 'timed out' : cancelled ? 'was cancelled' : 'failed'}`,
      502,
      { provider: options.provider }
    )
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

export function withQuery(baseUrl: string, path: string, params: Record<string, unknown>): string {
  const url = path
    ? new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    : new URL(baseUrl)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }
  return url.toString()
}
