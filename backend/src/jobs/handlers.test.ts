import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppContext } from '../app/context.js'
import type { Job } from '../db/types.js'

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(),
  createDependencies: vi.fn(),
  execute: vi.fn()
}))

vi.mock('../route-generation/repository.js', () => ({
  PostgresRouteGenerationRunRepository: class {
    get = mocks.getRun
  }
}))
vi.mock('../route-generation/composition.js', () => ({
  createRouteGenerationDependencies: mocks.createDependencies
}))
vi.mock('../route-generation/service.js', () => ({
  executeRouteGenerationRun: mocks.execute
}))

import { handleJob } from './handlers.js'

function job(payload: Job['payload']): Job {
  const now = new Date()
  return {
    id: '1', type: 'route_generation', payload, status: 'processing',
    run_at: now, attempts: 1, max_attempts: 3,
    locked_by: 'worker', locked_at: now, last_error: null,
    created_at: now, updated_at: now, completed_at: null
  }
}

describe('route_generation job integration', () => {
  beforeEach(() => vi.clearAllMocks())

  it('resolves the trusted run owner before constructing scoped dependencies', async () => {
    const runId = '019cc742-d918-7b02-94c2-c2bccf6d9534'
    const dependencies = { scoped: true }
    mocks.getRun.mockResolvedValue({ id: runId, ownerId: 'internal-user-7' })
    mocks.createDependencies.mockReturnValue(dependencies)
    mocks.execute.mockResolvedValue({ status: 'succeeded' })

    await handleJob({ db: {} } as AppContext, job({ runId }))

    expect(mocks.createDependencies).toHaveBeenCalledWith(expect.anything(), 'internal-user-7')
    expect(mocks.execute).toHaveBeenCalledWith(dependencies, runId)
  })

  it('fails closed for malformed or unknown run payloads', async () => {
    await expect(handleJob({ db: {} } as AppContext, job({}))).rejects.toMatchObject({ code: 'INVALID_JOB' })
    mocks.getRun.mockResolvedValue(undefined)
    await expect(handleJob({ db: {} } as AppContext, job({ runId: '019cc742-d918-7b02-94c2-c2bccf6d9534' })))
      .rejects.toMatchObject({ code: 'INVALID_JOB' })
  })
})
