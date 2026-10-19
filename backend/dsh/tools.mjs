import { defineTool } from '../.dsh-runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import { repo, dataRoot } from '../src/paths.mjs'
import { PlaceBatch, placeBudgetMs } from '../src/place-batch.mjs'
const execute = promisify(execFile)
export const name = 'flightor-tools'
export const inject = ['tools']
export async function apply(ctx) {
  if (process.env.FLIGHTOR_DSH_ROLE === 'reviewer' && process.env.FLIGHTOR_DSH_PLACE_LEDGER) {
    const batch = new PlaceBatch({ file: process.env.FLIGHTOR_DSH_PLACE_LEDGER })
    ctx.tools.register(defineTool({
      name: 'lookup_places_batch',
      description: '批量查询整份行程的景点图片和坐标。首次一次传全部景点并使用稳定活动id（如d1-a1）。只返回字段状态，实际URL/坐标由后端保存合并，不要抄写。found字段锁定；仅refinable中的not-found字段可改关键词再查一次。unavailable/timed-out是网络或预算问题，禁止语义重试；remainingMs为所有调用共享的剩余预算。最终JSON保留每个活动相同id。',
      parameters: { places: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true, description: '稳定活动id，最终JSON保留，不能复用或变更' },
        name: { type: 'string', required: true }, city: { type: 'string', required: true },
        query: { type: 'string', description: '准确英文/当地景点名，城市单列；不附邮编、街道地址或搜索运算符' },
        imageQuery: { type: 'string' }, locationQuery: { type: 'string' },
        fields: { type: 'array', items: { type: 'string', enum: ['image', 'location'] }, description: '默认两个字段；修正时仅传缺失字段' }
      } } } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      timeoutMs: placeBudgetMs() + 5000,
      isConcurrencySafe: () => false,
      execute: (args, exec) => batch.run(args, { signal: exec.signal })
    }))
  }
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
