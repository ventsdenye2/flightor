import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { loginWithWechat, rotateRefreshToken } from '../auth/service.js'

const loginSchema = z.object({
  code: z.string().min(1).max(256),
  nickname: z.string().trim().max(80).default(''),
  avatar_url: z.string().url().or(z.literal('')).default('')
})

const refreshSchema = z.object({ refresh_token: z.string().min(20).max(512) })

export async function registerAuthRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/v1/auth/wechat', async request => {
    const input = loginSchema.parse(request.body)
    return loginWithWechat(context, {
      code: input.code,
      nickname: input.nickname,
      avatarUrl: input.avatar_url
    })
  })

  app.post('/v1/auth/refresh', async request => {
    const input = refreshSchema.parse(request.body)
    return rotateRefreshToken(context, input.refresh_token)
  })
}
