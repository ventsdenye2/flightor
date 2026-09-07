import { AppError } from '../lib/errors.js'

const MAX_ENTRIES = 512
const TTL_MS = 24 * 60 * 60 * 1000

interface CompletedEntry<T> {
  requestHash: string
  value: T
  expiresAt: number
}

interface PendingEntry<T> {
  requestHash: string
  promise: Promise<T>
}

export interface IdempotentResult<T> {
  value: T
  replayed: boolean
}

/**
 * Bounded process-local idempotency for the manual search compatibility route.
 * The owner is part of the key, and in-flight requests share one promise so a
 * double tap cannot create two artifacts in this process.
 *
 * A durable store can implement the same run contract when the manual search
 * action receives a database idempotency table; this bounded fallback keeps
 * the route safe for the current single-process deployment and tests.
 */
export class InMemoryFlightSearchIdempotencyStore<T> {
  private readonly completed = new Map<string, CompletedEntry<T>>()
  private readonly pending = new Map<string, PendingEntry<T>>()

  get size(): number { return this.completed.size }

  async run(ownerId: string, idempotencyKey: string, requestHash: string, work: () => Promise<T>): Promise<IdempotentResult<T>> {
    this.evictExpired()
    const key = `${ownerId}\u0000${idempotencyKey}`
    const completed = this.completed.get(key)
    if (completed) {
      if (completed.requestHash !== requestHash) throw this.reuseError()
      return { value: completed.value, replayed: true }
    }

    const pending = this.pending.get(key)
    if (pending) {
      if (pending.requestHash !== requestHash) throw this.reuseError()
      return { value: await pending.promise, replayed: true }
    }

    const promise = work()
      .then(value => {
        this.pending.delete(key)
        this.completed.delete(key)
        this.completed.set(key, { requestHash, value, expiresAt: Date.now() + TTL_MS })
        this.trim()
        return value
      })
      .catch(error => {
        this.pending.delete(key)
        throw error
      })
    this.pending.set(key, { requestHash, promise })
    return { value: await promise, replayed: false }
  }

  clear(): void {
    this.completed.clear()
    this.pending.clear()
  }

  private reuseError(): AppError {
    return new AppError('IDEMPOTENCY_KEY_REUSE', 'Idempotency-Key was already used for a different request', 409)
  }

  private evictExpired(): void {
    const now = Date.now()
    for (const [key, entry] of this.completed) if (entry.expiresAt <= now) this.completed.delete(key)
  }

  private trim(): void {
    while (this.completed.size > MAX_ENTRIES) {
      const oldest = this.completed.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.completed.delete(oldest)
    }
  }
}

export const FLIGHT_SEARCH_IDEMPOTENCY_MAX_ENTRIES = MAX_ENTRIES
