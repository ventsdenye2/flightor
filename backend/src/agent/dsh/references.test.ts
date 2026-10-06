import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DshReferences, type DshReferenceScope } from './references.js'

const scope: DshReferenceScope = { ownerId: 'owner', tripId: 'trip', conversationId: 'conversation', generationId: 'generation', tripContextVersion: 4 }
const candidate = () => `gc1.${randomUUID()}.${'a'.repeat(32)}`

describe('DSH per-turn candidate references', () => {
  it('maps an existing persisted candidate to a stable short alias within the turn', () => {
    const refs = new DshReferences(scope)
    const persisted = candidate()
    const short = refs.registerCandidate(persisted)!
    expect(short).toMatch(/^C-[a-f0-9]{10}-1$/)
    expect(refs.registerCandidate(persisted)).toBe(short)
    expect(refs.resolveCandidate(short)).toBe(persisted)
    expect(refs.resolveCandidate(persisted)).toBe(persisted)
  })

  it('does not resolve an alias in a different generation or Trip snapshot', () => {
    const persisted = candidate()
    const short = new DshReferences(scope).registerCandidate(persisted)!
    expect(new DshReferences({ ...scope, generationId: 'another-generation' }).resolveCandidate(short)).toBeUndefined()
    expect(new DshReferences({ ...scope, tripContextVersion: 5 }).resolveCandidate(short)).toBeUndefined()
  })

  it('leaves malformed and unknown references unresolved for domain rejection', () => {
    const refs = new DshReferences(scope)
    expect(refs.registerCandidate('fake')).toBeUndefined()
    expect(refs.resolveCandidate('C-unknown-1')).toBeUndefined()
    expect(refs.resolveCandidate('fake')).toBeUndefined()
  })
})
