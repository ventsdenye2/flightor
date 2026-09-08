import Taro from '@tarojs/taro'

/** Credentials and their identity revision have one owner, independent of UI stores. */
export interface AuthSnapshot { revision: number; accessToken: string; refreshToken: string }
export interface AuthTokens { accessToken: string; refreshToken: string }

let revision = 0
let refreshing: { revision: number; promise: Promise<void> } | undefined
const invalidationHandlers = new Set<() => void>()

export class AuthSessionChangedError extends Error {
  constructor() { super('AUTH_SESSION_CHANGED'); this.name = 'AuthSessionChangedError' }
}

function token(key: string): string {
  const value = Taro.getStorageSync(key)
  return typeof value === 'string' ? value : ''
}

export function authSnapshot(): AuthSnapshot {
  return { revision, accessToken: token('access_token'), refreshToken: token('refresh_token') }
}

export function assertAuthSession(expectedRevision: number): void {
  if (revision !== expectedRevision) throw new AuthSessionChangedError()
}

/** Starting login supersedes refreshes and requests belonging to the old session. */
export function beginAuthSession(): number { return ++revision }

export function commitAuthTokens(tokens: AuthTokens, expectedRevision: number): void {
  assertAuthSession(expectedRevision)
  Taro.setStorageSync('access_token', tokens.accessToken)
  Taro.setStorageSync('refresh_token', tokens.refreshToken)
  revision += 1
}

export function clearAuthSession(): void {
  revision += 1
  for (const key of ['access_token', 'refresh_token']) {
    try { Taro.removeStorageSync(key) } catch { /* Already absent or unavailable. */ }
  }
}

export function onAuthInvalidated(handler: () => void): () => void {
  invalidationHandlers.add(handler)
  return () => invalidationHandlers.delete(handler)
}

export function invalidateAuthSession(expectedRevision: number): void {
  if (revision !== expectedRevision) return
  clearAuthSession()
  for (const handler of invalidationHandlers) handler()
}

/** Concurrent 401s share one rotating refresh; late replies cannot revive a logout. */
export async function refreshAuthSession(snapshot: AuthSnapshot, exchange: (refreshToken: string) => Promise<AuthTokens>): Promise<void> {
  assertAuthSession(snapshot.revision)
  const current = authSnapshot()
  if (current.accessToken && current.accessToken !== snapshot.accessToken) return
  if (!current.refreshToken) {
    invalidateAuthSession(snapshot.revision)
    throw new Error('AUTH_REQUIRED')
  }
  if (refreshing?.revision === snapshot.revision) return refreshing.promise
  const promise = (async () => {
    try {
      const tokens = await exchange(current.refreshToken)
      assertAuthSession(snapshot.revision)
      // Rotation keeps the same identity revision so all waiting requests can retry.
      Taro.setStorageSync('access_token', tokens.accessToken)
      Taro.setStorageSync('refresh_token', tokens.refreshToken)
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status === 400 || status === 401 || status === 403) invalidateAuthSession(snapshot.revision)
      throw error
    }
  })()
  refreshing = { revision: snapshot.revision, promise }
  try { await promise } finally { if (refreshing?.promise === promise) refreshing = undefined }
}
