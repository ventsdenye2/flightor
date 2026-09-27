const RETRYABLE = new Set(['TRANSPORT', 'TIMEOUT', 'RATE_LIMIT', 'SERVER'])
export const MAX_PROVIDER_RETRIES = 2

export function providerFailureCode(chunk) {
  return chunk?.type === 'finish' && chunk.reason?.kind === 'error'
    ? chunk.reason.failure?.code : undefined
}

export function mayRetryProvider({ chunk, emitted, signal, retries }) {
  return !emitted && !signal?.aborted && retries < MAX_PROVIDER_RETRIES && RETRYABLE.has(providerFailureCode(chunk))
}

export async function retryPause(retries, signal) {
  const duration = retries === 0 ? 250 : 750
  if (signal?.aborted) return false
  return new Promise(resolve => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(true) }, duration)
    const abort = () => { clearTimeout(timer); resolve(false) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
