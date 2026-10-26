import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { repo, dataRoot } from './paths.mjs'
import { requestFlightWorker } from '../../trip-flight-tool/dist/worker.js'

const executeFile = promisify(execFile)

export async function executeFlightDetails(args, { signal, execute = executeFile, refresh = false, worker = process.env.TRIP_FLIGHT_WORKER_URL ? requestFlightWorker : null } = {}) {
  if (worker && execute === executeFile) return worker('details', args, { signal, refresh })
  const cli = path.join(repo, 'trip-flight-tool/dist/cli.js')
  const argv = [cli, 'details', '--search-id', args.searchId, '--candidate-id', args.candidateId]
  if (refresh) argv.push('--refresh')
  let stdout
  try { stdout = (await execute(process.execPath, argv, { cwd: path.dirname(cli), signal, timeout: 205000, maxBuffer: 2e6, windowsHide: true })).stdout }
  catch (error) { signal?.throwIfAborted(); if (!error.stdout) throw error; stdout = error.stdout }
  signal?.throwIfAborted()
  return JSON.parse(stdout)
}

// The Agent tool and the manual search use the same CLI and snapshot store.
export async function executeFlightSearch(args, { signal, root = dataRoot, execute = executeFile, worker = process.env.TRIP_FLIGHT_WORKER_URL ? requestFlightWorker : null } = {}) {
  const cli = path.join(repo, 'trip-flight-tool/dist/cli.js')
  const argv = [cli, 'search', '--from', args.origin, '--to', args.destination, '--date', args.departureDate,
    '--currency', args.currency || 'USD', '--max-results', '3', '--trip-type', args.tripType || 'one_way', '--adults', String(args.adults ?? 1)]
  if (args.returnDate) argv.push('--return-date', args.returnDate)
  let result
  if (worker && execute === executeFile) result = await worker('search', { ...args, maxResults: 3 }, { signal })
  else {
    let stdout
    try {
      stdout = (await execute(process.execPath, argv, { cwd: path.dirname(cli), signal, timeout: 205000, maxBuffer: 2e6, windowsHide: true })).stdout
    } catch (error) {
      signal?.throwIfAborted()
      if (!error.stdout) throw error
      stdout = error.stdout
    }
    result = JSON.parse(stdout)
  }
  signal?.throwIfAborted()
  const resultId = /^[a-f\d-]{36}$/i.test(result.searchId || '') ? result.searchId : randomUUID()
  const target = path.join(root, 'flight-results')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, resultId + '.json'), JSON.stringify(result.query ? result : { ...result, query: args }, null, 2))
  return result
}
