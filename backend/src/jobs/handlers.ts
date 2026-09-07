import type { AppContext } from '../app/context.js'
import type { Job, JsonValue } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import { createRouteGenerationDependencies } from '../route-generation/composition.js'
import { PostgresRouteGenerationRunRepository } from '../route-generation/repository.js'
import { executeRouteGenerationRun } from '../route-generation/service.js'
import { syncOagLocation, syncOagRoute } from '../topology/sync.js'
import { runProductionDiscovery } from '../discovery/service.js'

function objectPayload(job: Job): Record<string, JsonValue> {
  if (!job.payload || Array.isArray(job.payload) || typeof job.payload !== 'object') {
    throw new AppError('INVALID_JOB', 'Job payload must be an object')
  }
  return job.payload
}

export async function handleJob(context: AppContext, job: Job): Promise<void> {
  const payload = objectPayload(job)
  switch (job.type) {
    case 'noop':
      return
    case 'discover_templates': {
      if (typeof payload.runId !== 'string') throw new AppError('INVALID_JOB', 'Discovery requires a run ID')
      await runProductionDiscovery(context, payload.runId)
      return
    }
    case 'oag_locations_probe': {
      const params: { airportCode?: string; countryCode?: string; cityCode?: string; limit: number } = {
        limit: typeof payload.limit === 'number' ? payload.limit : 10
      }
      if (typeof payload.airportCode === 'string') params.airportCode = payload.airportCode
      if (typeof payload.countryCode === 'string') params.countryCode = payload.countryCode
      if (typeof payload.cityCode === 'string') params.cityCode = payload.cityCode
      await context.providers.oag.locations(params)
      return
    }
    case 'oag_sync_location': {
      if (typeof payload.airportCode !== 'string') {
        throw new AppError('INVALID_JOB', 'oag_sync_location requires airportCode')
      }
      await syncOagLocation(context, payload.airportCode)
      return
    }
    case 'oag_sync_route': {
      if (typeof payload.origin !== 'string' || typeof payload.destination !== 'string' || typeof payload.dateFrom !== 'string') {
        throw new AppError('INVALID_JOB', 'oag_sync_route requires origin, destination and dateFrom')
      }
      const input: Parameters<typeof syncOagRoute>[1] = {
        origin: payload.origin,
        destination: payload.destination,
        dateFrom: payload.dateFrom
      }
      if (typeof payload.dateTo === 'string') input.dateTo = payload.dateTo
      if (typeof payload.includeConnections === 'boolean') input.includeConnections = payload.includeConnections
      if (typeof payload.limit === 'number') input.limit = payload.limit
      await syncOagRoute(context, input)
      return
    }
    case 'route_generation': {
      if (typeof payload.runId !== 'string') {
        throw new AppError('INVALID_JOB', 'route_generation requires runId')
      }
      const run = await new PostgresRouteGenerationRunRepository(context.db).get(payload.runId)
      if (!run) throw new AppError('INVALID_JOB', 'Route generation run was not found')

      const result = await executeRouteGenerationRun(
        createRouteGenerationDependencies(context, run.ownerId),
        payload.runId
      )
      if (!result) throw new AppError('INVALID_JOB', 'Route generation run was not found')
      if (result.status === 'running') {
        throw new AppError('ROUTE_GENERATION_BUSY', 'Route generation run is already active')
      }
      return
    }
    default:
      throw new AppError('UNKNOWN_JOB_TYPE', `No handler registered for job type ${job.type}`)
  }
}
