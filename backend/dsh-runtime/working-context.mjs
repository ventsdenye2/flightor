import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Replace only the model surface at an idle turn boundary. Original events stay
 * in the append-only session log; current-turn calls/results are never compacted.
 * The parent snapshot supplies current domain state and recent public dialogue.
 */
export function replaceWorkingContext(agent, snapshot) {
  const session = agent.session
  const nodes = [...session.surface.nodes]
  const events = new Map(session.snapshotEvents().map(event => [event.seq, event]))
  const retainedHead = events.get(nodes[0])?.type === 'system/message' ? 1 : 0
  const shadowed = nodes.slice(retainedHead)
  const message = createUserMessage({ content: [{ type: 'text', text: snapshot }], source: { kind: 'flightor-context' } })
  if (!shadowed.length) {
    agent.inject(message)
    return { shadowedMessages: 0 }
  }
  session.append('user/message', message, {
    surfaceOp: { op: 'replace', startSeq: shadowed[0], endSeq: shadowed.at(-1) },
    sourceEventSeqs: shadowed,
  })
  return { shadowedMessages: shadowed.length }
}
