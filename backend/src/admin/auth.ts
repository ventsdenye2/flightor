import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { SignJWT, jwtVerify } from 'jose'
import type { FastifyRequest } from 'fastify'
import type { AppContext } from '../app/context.js'
import { AppError } from '../lib/errors.js'

const scrypt = promisify(scryptCallback)
export type AdminRole = 'viewer' | 'reviewer' | 'admin'
export interface AdminIdentity { id: string; email: string; role: AdminRole; tokenVersion: number }
export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex'), digest = await scrypt(password, salt, 64) as Buffer
  return `scrypt:${salt}:${digest.toString('hex')}`
}
export async function verifyAdminPassword(password: string, hash: string): Promise<boolean> {
  const [kind, salt, hex] = hash.split(':')
  if (kind !== 'scrypt' || !salt || !hex || !/^[0-9a-f]{128}$/.test(hex)) return false
  const digest = await scrypt(password, salt, 64) as Buffer
  return timingSafeEqual(digest, Buffer.from(hex, 'hex'))
}
export async function issueAdminToken(identity: AdminIdentity, secret: string): Promise<string> {
  return new SignJWT({ version: identity.tokenVersion }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setSubject(identity.id).setIssuer('flightor-editorial').setAudience('flightor-admin').setIssuedAt().setExpirationTime('2h').sign(new TextEncoder().encode(secret))
}
export async function verifyAdminToken(token: string, secret: string): Promise<{ id: string; version: number }> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'], issuer: 'flightor-editorial', audience: 'flightor-admin' })
    if (!payload.sub || !Number.isInteger(payload.version)) throw new Error('invalid identity')
    return { id: payload.sub, version: Number(payload.version) }
  } catch { throw new AppError('ADMIN_UNAUTHORIZED', 'Admin session is invalid or expired', 401) }
}
export async function authenticateAdmin(request: FastifyRequest, context: AppContext, minimum: AdminRole = 'viewer'): Promise<AdminIdentity> {
  const bearer = request.headers.authorization
  if (!bearer?.startsWith('Bearer ')) throw new AppError('ADMIN_UNAUTHORIZED', 'Admin sign-in is required', 401)
  const identity = await verifyAdminToken(bearer.slice(7), context.env.JWT_SECRET)
  const user = await context.db.selectFrom('admin_users').select(['id', 'email', 'role', 'token_version']).where('id', '=', identity.id).where('active', '=', true).executeTakeFirst()
  if (!user || user.token_version !== identity.version) throw new AppError('ADMIN_UNAUTHORIZED', 'Admin session has been revoked', 401)
  const levels = { viewer: 0, reviewer: 1, admin: 2 }
  if (levels[user.role] < levels[minimum]) throw new AppError('ADMIN_FORBIDDEN', 'This action requires a reviewer role', 403)
  return { id: user.id, email: user.email, role: user.role, tokenVersion: user.token_version }
}
