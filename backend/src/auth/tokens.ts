import { SignJWT, jwtVerify } from 'jose'
import type { AppEnv } from '../config/env.js'
import { AppError } from '../lib/errors.js'

export interface AccessIdentity {
  userId: string
  publicId: string
}

function secretOf(env: AppEnv): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET)
}

export async function issueAccessToken(identity: AccessIdentity, env: AppEnv): Promise<string> {
  return new SignJWT({ uid: identity.userId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(identity.publicId)
    .setIssuer('flightor-api')
    .setAudience('flightor-miniapp')
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretOf(env))
}

export async function verifyAccessToken(token: string, env: AppEnv): Promise<AccessIdentity> {
  try {
    const result = await jwtVerify(token, secretOf(env), {
      issuer: 'flightor-api',
      audience: 'flightor-miniapp'
    })
    if (!result.payload.sub || typeof result.payload.uid !== 'string') throw new Error('missing identity')
    return { userId: result.payload.uid, publicId: result.payload.sub }
  } catch {
    throw new AppError('UNAUTHORIZED', 'Access token is invalid or expired', 401)
  }
}
