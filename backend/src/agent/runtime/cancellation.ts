/** Own the task before starting it, including rejection after cancellation. */
export async function settleWithSignal<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve().then(() => {
      signal.throwIfAborted()
      return start()
    }).then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
