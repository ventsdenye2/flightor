import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import type { AppContext } from './app/context.js'
import { isAppError } from './lib/errors.js'
import { registerAdminSyncRoutes } from './routes/admin-sync.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerFlightSearchRoutes } from './routes/flight-searches.js'
import { registerHealthRoutes } from './routes/health.js'
import { registerPreferenceRoutes } from './routes/preferences.js'
import { registerReferenceDataRoutes } from './routes/reference-data.js'
import { registerTopologyRoutes } from './routes/topology.js'

export async function buildApp(context: AppContext) {
  const app = Fastify({
    logger: {
      level: context.env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.subscription-key',
          'body.refresh_token',
          'body.code',
          '*.apiKey',
          '*.token'
        ],
        censor: '[REDACTED]'
      }
    },
    trustProxy: true,
    requestIdHeader: 'x-request-id'
  })

  await app.register(cors, {
    origin: context.env.NODE_ENV === 'development',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  })
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    redis: context.redis,
    keyGenerator: request => request.headers.authorization
      ? `auth:${request.headers.authorization.slice(-24)}`
      : `ip:${request.ip}`
  })
  await app.register(swagger, {
    openapi: {
      info: { title: 'FlightOR API', version: '0.1.0' },
      servers: [{ url: '/'}]
    }
  })
  await app.register(swaggerUi, { routePrefix: '/docs' })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'INVALID_REQUEST', message: 'Request validation failed', details: error.issues },
        requestId: request.id
      })
    }
    if (isAppError(error)) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id
      })
    }
    request.log.error({ err: error }, 'Unhandled request error')
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      requestId: request.id
    })
  })

  await registerHealthRoutes(app, context)
  await registerAdminSyncRoutes(app, context)
  await registerAuthRoutes(app, context)
  await registerFlightSearchRoutes(app, context)
  await registerReferenceDataRoutes(app, context)
  await registerPreferenceRoutes(app, context)
  await registerTopologyRoutes(app, context)
  return app
}
