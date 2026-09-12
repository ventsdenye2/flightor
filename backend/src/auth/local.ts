import { timingSafeEqual } from 'node:crypto'
import type { AppEnv } from '../config/env.js'
import { sha256 } from '../lib/crypto.js'
import { AppError } from '../lib/errors.js'

export function isLocalLoginEnabled(env: AppEnv): boolean {
  return env.LOCAL_LOGIN_ENABLED && env.NODE_ENV !== 'production'
    && ['127.0.0.1', '::1'].includes(env.HOST) && env.LOCAL_LOGIN_KEY.length >= 32
}

/** Local transport and an explicit shared key are both required; proxy headers are never trusted. */
export function authorizeLocalLogin(env: AppEnv, remoteAddress: string | undefined, key: unknown): void {
  if (!isLocalLoginEnabled(env)) {
    throw new AppError('LOCAL_LOGIN_DISABLED', 'Local test sign-in is not enabled', 404)
  }
  if (!remoteAddress || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress)
    || typeof key !== 'string'
    || !timingSafeEqual(Buffer.from(sha256(key), 'hex'), Buffer.from(sha256(env.LOCAL_LOGIN_KEY), 'hex'))) {
    throw new AppError('LOCAL_LOGIN_REJECTED', 'Local test sign-in was rejected', 403)
  }
}
