import { defineTool } from '../.dsh-runtime/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import { repo, dataRoot } from '../src/paths.mjs'
import { PlaceBatch } from '../src/place-batch.mjs'
import { executeFlightSearch } from '../src/flight-query.mjs'
import { ConversationSubmission, submissionTool } from '../src/conversation-protocol.mjs'
import { ItinerarySubmission, itinerarySchema, itinerarySubmissionTool } from '../src/itinerary-protocol.mjs'
const execute = promisify(execFile)
export const name = 'flightor-tools'
export const inject = ['tools']
export async function apply(ctx) {
  if (process.env.FLIGHTOR_DSH_ROLE === 'conversation' && process.env.FLIGHTOR_DSH_SUBMISSION) {
    const submission = new ConversationSubmission(process.env.FLIGHTOR_DSH_SUBMISSION)
    ctx.tools.guard(exec => submission.guard(exec))
    ctx.tools.register(defineTool({
      name: submissionTool,
      description: '提交本轮最终回复，必须显式填写非空 reply 和 intent(chat或plan)。需要规划时只简短确认。成功后结束本轮，不另写JSON正文；相同提交幂等，不同结果冲突失败。字段错误只允许一次补正，补正时只用本工具，不查票或搜索。',
      parameters: {
        reply: { type: 'string', required: true },
        intent: { type: 'string', enum: ['chat', 'plan'], required: true }
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => false,
      execute: (args, exec) => submission.submit(args, exec)
    }))
  }
  if (process.env.FLIGHTOR_DSH_ROLE === 'reviewer' && process.env.FLIGHTOR_DSH_ITINERARY_SUBMISSION) {
    const submission = new ItinerarySubmission(process.env.FLIGHTOR_DSH_ITINERARY_SUBMISSION)
    ctx.tools.guard(exec => submission.guard(exec))
    ctx.tools.register(defineTool({
      name: itinerarySubmissionTool,
      description: '提交本轮最终结构化行程。必须先按需完成 lookup_places_batch，再调用本工具一次并传入 itinerary 对象；提交对象是最终交付，不另写JSON正文。成功后结束本轮。相同对象幂等，不同对象冲突失败；字段错误只允许一次补正，补正时只用本工具，不重新查询、搜索或查票。',
      parameters: { itinerary: { ...itinerarySchema, required: true } },
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      isConcurrencySafe: () => false,
      execute: (args, exec) => submission.submit(args, exec)
    }))
  }
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
      // PlaceBatch owns the count-based shared deadline; a fixed tool timeout would cut long trips short.
      isConcurrencySafe: () => false,
      execute: (args, exec) => batch.run(args, { signal: exec.signal })
    }))
  }
  ctx.tools.register(defineTool({
    name: 'search_flights',
    description: '通过 Trip.com CLI 查询单程或往返真实航班。城市名查全城机场，机场名查具体机场。根据语境选择tripType；往返必须同时输入去程departureDate和返程returnDate，缺日期先问用户。支持1到9名成人经济舱，adults按用户人数填写。返回候选不代表用户确认；遇访问限制停止。价格为每成人查询快照。',
    parameters: {
      origin: { type: 'string', required: true, description: '城市/机场代码，例如 BJS' },
      destination: { type: 'string', required: true, description: '城市/机场代码，例如 LIS' },
      departureDate: { type: 'string', required: true, description: 'YYYY-MM-DD，当地出发日期' },
      tripType: { type: 'string', enum: ['one_way', 'round_trip'], description: 'one_way单程（默认），round_trip往返；结合用户语境选择' },
      returnDate: { type: 'string', description: 'YYYY-MM-DD，返程当地出发日期；round_trip必须传，one_way不传' },
      adults: { type: 'number', description: '成人数，1到9的整数，省略默认1；按用户人数传入' },
      currency: { type: 'string', description: 'USD/CNY/EUR/GBP/HKD/SGD，默认 USD' }
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    timeoutMs: 210000,
    isConcurrencySafe: () => false,
    execute: (args, exec) => executeFlightSearch(args, { signal: exec.signal })
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
