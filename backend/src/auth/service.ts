import type { FastifyRequest } from 'fastify'
import type { AppContext } from '../app/context.js'
import { AppError } from '../lib/errors.js'
import { randomToken, sha256 } from '../lib/crypto.js'
import { issueAccessToken, verifyAccessToken, type AccessIdentity } from './tokens.js'
import { codeToWechatOpenId } from './wechat.js'
import { PostgresUserIdentityRepository } from '../identity/postgres.js'

export interface TokenPair {
  accessToken: string
  accessTokenExpiresIn: number
  refreshToken: string
  refreshTokenExpiresAt: string
  user: { id: string; nickname: string; avatarUrl: string }
}

async function createSession(
  context: AppContext,
  user: { id: string; public_id: string; nickname: string; avatar_url: string }
): Promise<TokenPair> {
  const refreshToken = randomToken()
  const refreshExpiresAt = new Date(Date.now() + context.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000)
  await context.db.insertInto('user_sessions').values({
    user_id: user.id,
    refresh_token_hash: sha256(refreshToken),
    expires_at: refreshExpiresAt,
    revoked_at: null,
    rotated_at: null
  }).execute()
  const accessToken = await issueAccessToken({ userId: user.id, publicId: user.public_id }, context.env)
  return {
    accessToken,
    accessTokenExpiresIn: context.env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    user: { id: user.public_id, nickname: user.nickname, avatarUrl: user.avatar_url }
  }
}

export async function loginWithWechat(
  context: AppContext,
  input: { code: string; nickname: string; avatarUrl: string }
): Promise<TokenPair> {
  const openid = await codeToWechatOpenId(input.code, context.env)
  const user = await new PostgresUserIdentityRepository(context.db).resolveWechat({
    providerSubject: openid,
    nickname: input.nickname,
    avatarUrl: input.avatarUrl
  })
  return createSession(context, {
    id: user.userId,
    public_id: user.publicId,
    nickname: user.nickname,
    avatar_url: user.avatarUrl
  })
}

export async function rotateRefreshToken(context: AppContext, refreshToken: string): Promise<TokenPair> {
  const tokenHash = sha256(refreshToken)
  return context.db.transaction().execute(async trx => {
    const session = await trx
      .selectFrom('user_sessions')
      .innerJoin('users', 'users.id', 'user_sessions.user_id')
      .select([
        'user_sessions.id as session_id',
        'users.id',
        'users.public_id',
        'users.nickname',
        'users.avatar_url'
      ])
      .where('user_sessions.refresh_token_hash', '=', tokenHash)
      .where('user_sessions.revoked_at', 'is', null)
      .where('user_sessions.expires_at', '>', new Date())
      .forUpdate()
      .executeTakeFirst()
    if (!session) throw new AppError('UNAUTHORIZED', 'Refresh token is invalid or expired', 401)

    const now = new Date()
    await trx.updateTable('user_sessions')
      .set({ revoked_at: now, rotated_at: now })
      .where('id', '=', session.session_id)
      .execute()

    const nextRefreshToken = randomToken()
    const refreshExpiresAt = new Date(Date.now() + context.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000)
    await trx.insertInto('user_sessions').values({
      user_id: session.id,
      refresh_token_hash: sha256(nextRefreshToken),
      expires_at: refreshExpiresAt,
      revoked_at: null,
      rotated_at: null
    }).execute()
    const accessToken = await issueAccessToken({ userId: session.id, publicId: session.public_id }, context.env)
    return {
      accessToken,
      accessTokenExpiresIn: context.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: nextRefreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      user: { id: session.public_id, nickname: session.nickname, avatarUrl: session.avatar_url }
    }
  })
}

export async function authenticateRequest(request: FastifyRequest, context: AppContext): Promise<AccessIdentity> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHORIZED', 'Bearer token is required', 401)
  return verifyAccessToken(header.slice(7), context.env)
}
