import { Redis } from 'ioredis'
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { db } from './db/index.js'
import { createProviders } from './providers/index.js'

const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 })
redis.on('error', (error: Error) => {
  console.error(JSON.stringify({ event: 'redis_error', message: error instanceof Error ? error.message : 'unknown error' }))
})

async function main(): Promise<void> {
  await redis.connect()
  const app = await buildApp({ db, redis, env, providers: createProviders(env) })

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down')
    await app.close()
    if (redis.status !== 'end') await redis.quit()
    await db.destroy()
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  await app.listen({ host: env.HOST, port: env.PORT })
}

main().catch(async error => {
  console.error(JSON.stringify({ event: 'server_start_failed', message: error instanceof Error ? error.message : 'unknown error' }))
  if (redis.status !== 'end') await redis.quit()
  await db.destroy()
  process.exitCode = 1
})
