import fs from 'node:fs/promises'
import path from 'node:path'
import { dataRoot } from './paths.mjs'
import { loadConversation, saveConversation } from './conversation.mjs'
import { presentFlightOptions, resolveFlightSelection } from './flight-options.mjs'
import { executeFlightDetails } from './flight-query.mjs'
import { updateFlightChoice } from './conversation-timeline.mjs'

// Details share the normal async task, single-concurrency and cancellation path.
export async function runFlightDetails(run, { signal, root = dataRoot, onChange = async () => {}, details = executeFlightDetails } = {}) {
  try {
    const conversation = await loadConversation(run.conversationId, root)
    const { searchId, candidateId } = run.selection
    const anchor = conversation.messages.find(message => message.flightOptions?.searchId === searchId)
    const options = anchor?.flightOptions
    const option = options?.options.find(item => item.id === candidateId)
    if (!option) throw Error('请在查询所在的对话中查看航班')
    if (run.select && (conversation.flightSelectionLocked || conversation.flightOptions?.searchId !== searchId)) throw Error('这组选项已确定或已被新查询替代，请重新查询')
    run.stage = 'searching'
    run.progress = { text: run.select ? '正在核对所选航班价格与详情…' : '正在读取航段、行李与中转…', role: 'flight-search', updatedAt: new Date().toISOString() }
    await onChange(run)
    if (option.detailsState) {
      const result = await details({ searchId, candidateId }, { signal, refresh: !!run.select })
      signal?.throwIfAborted()
      if (result.status !== 'complete' || result.candidate?.id !== candidateId || !result.candidate.details) {
        const messages = { PRICE_CHANGED: '票价已变化，请重新查询后再选择。', RESULTS_CHANGED: '航班列表已变化或原查询页已失效，请重新查询后选择。', DETAILS_MISMATCH: '航班详情与所选记录不一致，请重新查询后选择。', ACCESS_RESTRICTED: '机票网站暂时限制访问，请稍后再试。' }
        throw Object.assign(Error(messages[result.code] || '未能核对航班详情，请稍后重试。'), { code: result.code || 'DETAILS_UNAVAILABLE' })
      }
      if (result.candidate.price.amount !== option.amount || result.candidate.price.currency !== option.currency) throw Object.assign(Error('票价已变化，请重新查询后再选择。'), { code: 'PRICE_CHANGED' })
      const mapped = presentFlightOptions({ ...result, candidates: [result.candidate] }).options[0]
      Object.assign(option, mapped)
      if (conversation.flightOptions?.searchId === searchId) {
        const current = conversation.flightOptions.options.find(item => item.id === candidateId)
        if (current) Object.assign(current, mapped)
      }
      // Keep actual detail evidence with this conversation for later planning.
      const file = path.join(root, 'conversation-evidence', conversation.id + '.json')
      const evidence = JSON.parse(await fs.readFile(file, 'utf8'))
      evidence.push(result)
      signal?.throwIfAborted()
      await fs.writeFile(file, JSON.stringify(evidence, null, 2))
      const snapshotFile = path.join(root, 'flight-results', searchId + '.json')
      const snapshot = JSON.parse(await fs.readFile(snapshotFile, 'utf8'))
      const stored = snapshot.candidates.find(item => item.id === candidateId)
      if (stored) Object.assign(stored, result.candidate)
      await fs.writeFile(snapshotFile, JSON.stringify(snapshot, null, 2))
    }
    signal?.throwIfAborted()
    if (run.select) updateFlightChoice(conversation, resolveFlightSelection(conversation, run.selection))
    conversation.updatedAt = new Date().toISOString()
    await saveConversation(conversation, root)
    run.conversation = conversation
    run.stage = 'completed'; run.completedAt = new Date().toISOString()
    await onChange(run)
    return run
  } catch (error) {
    run.stage = signal?.aborted ? 'cancelled' : 'failed'
    run.error = signal?.aborted ? '已取消航班详情查询' : String(error.message).slice(0, 500)
    if (!signal?.aborted && error.code) run.errorCode = error.code
    run.completedAt = new Date().toISOString()
    await onChange(run)
    throw error
  }
}
