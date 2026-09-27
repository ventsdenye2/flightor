export const DSH_PUBLIC_HISTORY_LIMITS = { messages: 12, characters: 12_000 } as const

/** Keep whole recent public messages; never truncate JSON or pretend this is the
 * audit transcript. Current domain state is supplied separately in the snapshot. */
export function compactPublicHistory(messages: ReadonlyArray<{ role: string; content: string }>) {
  const selected: Array<{ role: string; content: string }> = []
  let characters = 0
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (selected.length >= DSH_PUBLIC_HISTORY_LIMITS.messages) break
    if (characters + message.content.length > DSH_PUBLIC_HISTORY_LIMITS.characters) break
    selected.push({ role: message.role, content: message.content })
    characters += message.content.length
  }
  return selected.reverse()
}
