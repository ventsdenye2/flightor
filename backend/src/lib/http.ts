import { AppError } from './errors.js'

export interface FetchJsonOptions {
  timeoutMs?: number
  provider: string
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  options: FetchJsonOptions
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
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
    const timedOut = error instanceof Error && error.name === 'AbortError'
    throw new AppError(
      timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
      `${options.provider} request ${timedOut ? 'timed out' : 'failed'}`,
      502,
      { provider: options.provider }
    )
  } finally {
    clearTimeout(timer)
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
