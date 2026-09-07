import { PostgresDiscoveryRepository } from './discovery/postgres.js'
import { hostname } from 'node:os'
import { Redis } from 'ioredis'
import { env } from './config/env.js'
import { db } from './db/index.js'
import { handleJob } from './jobs/handlers.js'
import { claimNextJob, completeJob, failJob, heartbeatJob, recoverStaleJobs } from './jobs/repository.js'
import { createProviders } from './providers/index.js'

const workerId = `${hostname()}:${process.pid}`
const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 })
const context = { db, redis, env, providers: createProviders(env) }
let stopping = false
const STALE_RECOVERY_INTERVAL_MS = 60_000
const JOB_HEARTBEAT_INTERVAL_MS = 30_000

redis.on('error', (error: Error) => {
  console.error(JSON.stringify({ event: 'redis_error', message: error instanceof Error ? error.message : 'unknown error' }))
})

async function run(): Promise<void> {
  await redis.connect()
  let recovered = await recoverStaleJobs(db)
  let lastRecoveryAt = Date.now()
  const discovery = new PostgresDiscoveryRepository(db)
  await discovery.expire()
  await discovery.scheduleDueSources()
  console.log(JSON.stringify({ event: 'worker_started', workerId, recovered }))
  while (!stopping) {
    if (Date.now() - lastRecoveryAt >= STALE_RECOVERY_INTERVAL_MS) {
      await discovery.expire()
      await discovery.scheduleDueSources()
      recovered = await recoverStaleJobs(db)
      lastRecoveryAt = Date.now()
      if (recovered > 0) console.log(JSON.stringify({ event: 'stale_jobs_recovered', workerId, recovered }))
    }
    const job = await claimNextJob(db, workerId)
    if (!job) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      continue
    }
    const heartbeat = setInterval(() => {
      void heartbeatJob(db, job.id, workerId).catch(error => {
        console.error(JSON.stringify({
          event: 'job_heartbeat_failed', jobId: job.id, type: job.type,
          message: error instanceof Error ? error.message : 'unknown error'
        }))
      })
    }, JOB_HEARTBEAT_INTERVAL_MS)
    try {
      await handleJob(context, job)
      clearInterval(heartbeat)
      await completeJob(db, job.id)
      console.log(JSON.stringify({ event: 'job_completed', jobId: job.id, type: job.type }))
    } catch (error) {
      clearInterval(heartbeat)
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
