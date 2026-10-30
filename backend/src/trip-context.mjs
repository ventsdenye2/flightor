import fs from 'node:fs/promises'
import path from 'node:path'
import {dataRoot} from './paths.mjs'
import {loadConversation} from './conversation.mjs'
import {tripRunId,isSavedTrip} from './trip-identity.mjs'

// Resolve from the owning run, never from the currently active browser session.
// Older trips need no global conversation scan or model request.
export async function loadTripContext(id, root = dataRoot) {
  const runId=tripRunId(id)
  const run = JSON.parse(await fs.readFile(path.join(root, 'runs', runId + '.json'), 'utf8'))
  if (!isSavedTrip(run,runId) || !run.conversation?.id) throw Error('这段行程没有可恢复的原对话')
  const conversation = await loadConversation(run.conversation.id, root)
  if (conversation.id !== run.conversation.id) throw Error('行程所属对话不一致')
  const anchor = conversation.messages.find(message => message.role === 'assistant' && message.trip?.id === run.trip.id)
  if (!anchor) throw Error('原对话中没有这段行程，请重新打开行程后重试')
  const context = { conversationId: conversation.id, messageId: anchor.id, runId, tripId: run.trip.id }
  // Metadata in an older snapshot is advisory; the run and message own identity.
  anchor.trip = { ...anchor.trip, context }
  return { conversation, context }
}
