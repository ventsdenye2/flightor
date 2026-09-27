import { expect, it } from 'vitest'
import { compactPublicHistory } from './working-context.js'

it('keeps recent whole public dialogue, excluding tool/system history', () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message-${i}` }))
  expect(compactPublicHistory([...messages, { role: 'tool', content: 'private tool' }])).toEqual(messages.slice(-12))
})

it('bounds characters without changing original audit or returning partial messages', () => {
  const messages = [{ role: 'assistant', content: 'x'.repeat(12000) }, { role: 'user', content: 'current question' }]
  expect(compactPublicHistory(messages)).toEqual([messages[1]])
  expect(messages[0]!.content.length).toBe(12000)
})
