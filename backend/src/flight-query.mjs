import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { repo, dataRoot } from './paths.mjs'

const executeFile = promisify(execFile)

// The Agent tool and the manual search use the same CLI and snapshot store.
export async function executeFlightSearch(args, { signal, root = dataRoot, execute = executeFile } = {}) {
  const cli = path.join(repo, 'trip-flight-tool/dist/cli.js')
  const argv = [cli, 'search', '--from', args.origin, '--to', args.destination, '--date', args.departureDate,
    '--currency', args.currency || 'USD', '--max-results', '3', '--trip-type', args.tripType || 'one_way', '--adults', String(args.adults ?? 1)]
  if (args.returnDate) argv.push('--return-date', args.returnDate)
  let stdout
  try {
    stdout = (await execute(process.execPath, argv, { cwd: path.dirname(cli), signal, timeout: 205000, maxBuffer: 2e6, windowsHide: true })).stdout
  } catch (error) {
    signal?.throwIfAborted()
    if (!error.stdout) throw error
    stdout = error.stdout
  }
  signal?.throwIfAborted()
  const result = JSON.parse(stdout)
  const resultId = /^[a-f\d-]{36}$/i.test(result.searchId || '') ? result.searchId : randomUUID()
  const target = path.join(root, 'flight-results')
  await fs.mkdir(target, { recursive: true })
  await fs.writeFile(path.join(target, resultId + '.json'), JSON.stringify(result.query ? result : { ...result, query: args }, null, 2))
  return result
}
