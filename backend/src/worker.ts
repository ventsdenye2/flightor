import { hostname } from 'node:os'
import { Redis } from 'ioredis'
import { env } from './config/env.js'
import { db } from './db/index.js'
import { handleJob } from './jobs/handlers.js'
import { claimNextJob, completeJob, failJob, recoverStaleJobs } from './jobs/repository.js'
import { createProviders } from './providers/index.js'

const workerId = `${hostname()}:${process.pid}`
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 })
const context = { db, redis, env, providers: createProviders(env) }
let stopping = false

redis.on('error', (error: Error) => {
  console.error(JSON.stringify({ event: 'redis_error', message: error instanceof Error ? error.message : 'unknown error' }))
})

async function run(): Promise<void> {
  await redis.connect()
  const recovered = await recoverStaleJobs(db)
  console.log(JSON.stringify({ event: 'worker_started', workerId, recovered }))
  while (!stopping) {
    const job = await claimNextJob(db, workerId)
    if (!job) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      continue
    }
    try {
      await handleJob(context, job)
      await completeJob(db, job.id)
      console.log(JSON.stringify({ event: 'job_completed', jobId: job.id, type: job.type }))
    } catch (error) {
      await failJob(db, job, error)
      console.error(JSON.stringify({
        event: 'job_failed',
        jobId: job.id,
        type: job.type,
        message: error instanceof Error ? error.message : 'unknown error'
      }))
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  console.log(JSON.stringify({ event: 'worker_stopping', signal, workerId }))
  if (redis.status !== 'end') await redis.quit()
  await db.destroy()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

run().catch(async error => {
  console.error(JSON.stringify({ event: 'worker_crashed', message: error instanceof Error ? error.message : 'unknown error' }))
  await shutdown('error')
  process.exitCode = 1
})
