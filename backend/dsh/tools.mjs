import { defineTool } from '../.dsh-runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import { repo, dataRoot } from '../src/paths.mjs'
const execute = promisify(execFile)
export const name = 'flightor-tools'
export const inject = ['tools']
export async function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'search_flights',
    description: '通过现成 Trip.com CLI 查询指定日期的真实单程航班。现有CLI支持1名成人经济舱。遇访问限制直接报告。价格为查询结果。',
    parameters: {
      origin: { type: 'string', required: true, description: '城市/机场代码，例如 BJS' },
      destination: { type: 'string', required: true, description: '城市/机场代码，例如 LIS' },
      departureDate: { type: 'string', required: true, description: 'YYYY-MM-DD，当地出发日期' },
      currency: { type: 'string', description: 'USD/CNY/EUR/GBP/HKD/SGD，默认 USD' }
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    timeoutMs: 210000,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const cli = path.join(repo, 'trip-flight-tool/dist/cli.js')
      const argv = [cli, 'search', '--from', args.origin, '--to', args.destination, '--date', args.departureDate, '--currency', args.currency || 'USD', '--max-results', '3']
      let stdout
      try {
        stdout = (await execute(process.execPath, argv, { cwd: path.dirname(cli), signal: exec.signal, timeout: 205000, maxBuffer: 2e6, windowsHide: true })).stdout
      } catch (error) {
        if (!error.stdout) throw error
        stdout = error.stdout
      }
      const result = JSON.parse(stdout)
      const target = path.join(dataRoot, 'flight-results')
      await fs.mkdir(target, { recursive: true })
      if (result.searchId) await fs.writeFile(path.join(target, result.searchId + '.json'), JSON.stringify(result, null, 2))
      return result
    }
  }))
  ctx.tools.register(defineTool({
    name: 'get_flight_details',
    description: '用既有CLI读取已查询航班详情快照，不刷新报价；超过5分钟标为stale。用户提供searchId/candidateId时用它，不重新search。',
    parameters: { searchId: { type: 'string', required: true }, candidateId: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    timeoutMs: 15000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const cli = path.join(repo, 'trip-flight-tool/dist/cli.js')
      const { stdout } = await execute(process.execPath, [cli, 'details', '--search-id', args.searchId, '--candidate-id', args.candidateId], { cwd: path.dirname(cli), signal: exec.signal, timeout: 14000, maxBuffer: 2e6, windowsHide: true })
      return JSON.parse(stdout)
    }
  }))
  await fs.mkdir(dataRoot, { recursive: true })
  const audit = process.env.FLIGHTOR_DSH_AUDIT || path.join(dataRoot, 'tool-registration.json')
  await fs.mkdir(path.dirname(audit), { recursive: true })
  await fs.writeFile(audit, JSON.stringify({ tools: ctx.tools.schemas().map(tool => tool.name), at: new Date().toISOString() }, null, 2))
}
