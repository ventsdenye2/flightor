import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { searchInputSchema } from '../../trip-flight-tool/dist/core/types.js'
import { resolveLocation, validateDate } from '../../trip-flight-tool/dist/core/locations.js'
import { dataRoot } from './paths.mjs'
import { executeFlightSearch } from './flight-query.mjs'
import { loadConversation, saveConversation } from './conversation.mjs'
import { presentFlightOptions } from './flight-options.mjs'
import { attachFlightOptions, updateFlightChoice } from './conversation-timeline.mjs'

export function manualFlightQuery(input) {
  const parsed = searchInputSchema.safeParse(input)
  if (!parsed.success) throw Error('请填写有效的出发地、目的地和日期；成人数支持1到9位。')
  const query = parsed.data
  const origin = resolveLocation(query.origin), destination = resolveLocation(query.destination)
  if (origin.airports.some(code => destination.airports.includes(code))) throw Error('出发地和目的地不能相同。')
  validateDate(query, origin.timeZone)
  if (query.tripType === 'round_trip') {
    if (!query.returnDate) throw Error('往返查询需要去程和返程两个日期。')
    validateDate({ ...query, departureDate: query.returnDate }, destination.timeZone)
    if (query.returnDate < query.departureDate) throw Error('返程日期不能早于去程日期。')
  } else if (query.returnDate) throw Error('单程查询不需要返程日期。')
  return query
}

export async function runManualFlightSearch(run, { signal, onChange = async () => {}, root = dataRoot, search = executeFlightSearch } = {}) {
  try {
    const query = run.query
    const conversation = run.conversationId ? await loadConversation(run.conversationId, root)
      : { id: crypto.randomUUID(), messages: [], timelineVersion: 1, createdAt: new Date().toISOString() }
    run.stage = 'searching'
    run.progress = { text: '正在查询航班…', role: 'flight-search', updatedAt: new Date().toISOString() }
    await onChange(run)
    const result = await search(query, { signal, root })
    signal?.throwIfAborted()
    const options = presentFlightOptions(result)
    if (!options) {
      const messages = { ACCESS_RESTRICTED: '机票网站暂时限制访问，请稍后再试。', INVALID_ARGUMENTS: '查询条件无效，请检查地点和日期。', BROWSER_UNAVAILABLE: '航班查询服务暂时不可用。', RESULTS_TIMEOUT: '航班查询超时，请稍后重试。', TIMEOUT: '航班查询超时，请稍后重试。', PAGE_CHANGED: '机票网站页面发生变化，暂时无法完成查询，请稍后重试。', LOCATION_SELECTION_FAILED: '无法在机票网站确认所选城市或机场，请尝试选择具体机场。', QUERY_MISMATCH: '机票网站的地点或日期与查询条件不一致，请重新选择后查询。', NETWORK_ERROR: '机票网站连接失败，请稍后重试。' }
      throw Object.assign(Error(messages[result.code] || '本次航班查询未完成，请稍后重试。'), { code: result.code })
    }
    const directory = path.join(root, 'conversation-evidence'), file = path.join(directory, conversation.id + '.json')
    let evidence = []
    try { evidence = JSON.parse(await fs.readFile(file, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (conversation.selectedFlight) updateFlightChoice(conversation, conversation.selectedFlight, true)
    const replyId = crypto.randomUUID()
    conversation.messages.push({ id: crypto.randomUUID(), role: 'user', content: `查询${query.tripType === 'round_trip' ? '往返' : '单程'}机票：${query.origin} → ${query.destination}，去程 ${query.departureDate}${query.returnDate ? `，返程 ${query.returnDate}` : ''}，${query.adults}位成人经济舱，${query.currency}。先查票，不开始规划。` },
      { id: replyId, role: 'assistant', content: options.options.length ? '已查到这些航班，可以先比较和选择。' : '本次未查到可选航班，可以调整日期再查询。' })
    attachFlightOptions(conversation, options, replyId)
    conversation.updatedAt = new Date().toISOString()
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(file, JSON.stringify([...evidence, result], null, 2))
    signal?.throwIfAborted()
    await saveConversation(conversation, root)
    run.conversation = conversation
    run.planningRequested = false
    run.stage = 'completed'; run.completedAt = new Date().toISOString()
    await onChange(run)
    return run
  } catch (error) {
    run.stage = signal?.aborted ? 'cancelled' : 'failed'
    run.error = signal?.aborted ? '已取消航班查询' : String(error.message).slice(0, 500)
    if (!signal?.aborted && error.code) run.errorCode = error.code
    run.completedAt = new Date().toISOString()
    await onChange(run)
    throw error
  }
}
