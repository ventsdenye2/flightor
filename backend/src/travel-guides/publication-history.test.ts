import { describe, expect, it } from 'vitest'
import { GUIDE_LEGACY_REPLY } from './publication.js'
import { projectHistoricalGuideMessage } from './publication-history.js'
import type { ArtifactRecord } from '../artifacts/repository.js'

const scope = { tripId: 'trip-1', conversationId: 'conversation-1' }
const message = (role: 'user' | 'assistant', content: string, metadata: Record<string, unknown> = {}) => ({
  id: 'message-1', conversationId: scope.conversationId, role, content, metadata, createdAt: '2026-09-21T00:00:00.000Z'
} as const)
const record = (overrides: Partial<ArtifactRecord> = {}): ArtifactRecord => ({
  id: '00000000-0000-4000-8000-000000000001', tripId: scope.tripId, conversationId: scope.conversationId, type: 'travel_guide', schemaVersion: 1,
  payload: { invalid: true }, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z', ...overrides
})

describe('historical guide publication boundary', () => {
  it('never rewrites user messages even when they mention a guide artifact', async () => {
    const output = await projectHistoricalGuideMessage(message('user', 'raw guide reply', {
      delivery: { kind: 'travel_guide', status: 'satisfied', artifactIds: ['00000000-0000-4000-8000-000000000001'], missing: [], warnings: [], goals: [] },
      artifact_refs: ['00000000-0000-4000-8000-000000000001']
    }), { ...scope, artifacts: { get: async () => record() } })
    expect(output.content).toBe('raw guide reply')
  })

  it('replaces a guide assistant reply with the safe stored publication reply', async () => {
    const output = await projectHistoricalGuideMessage(message('assistant', 'raw model prose', {
      delivery: { kind: 'travel_guide', status: 'satisfied', artifactIds: ['00000000-0000-4000-8000-000000000001'], missing: [], warnings: [], goals: [] },
      artifact_refs: ['00000000-0000-4000-8000-000000000001']
    }), { ...scope, artifacts: { get: async () => record() } })
    expect(output.content).toBe(GUIDE_LEGACY_REPLY)
    expect(output.content).not.toContain('raw model prose')
  })

  it('uses the fixed legacy reply when the referenced guide is missing or out of scope', async () => {
    const output = await projectHistoricalGuideMessage(message('assistant', 'old raw prose', {
      delivery: { kind: 'travel_guide', status: 'satisfied', artifactIds: ['00000000-0000-4000-8000-000000000001'], missing: [], warnings: [], goals: [] },
      artifact_refs: ['00000000-0000-4000-8000-000000000001']
    }), { ...scope, artifacts: { get: async () => record({ tripId: 'other-trip' }) } })
    expect(output.content).toBe(GUIDE_LEGACY_REPLY)
  })

  it.each(['pending', 'failed', 'cancelled'] as const)('sanitizes a %s guide delivery notice', async status => {
    const original = `${status} 符合预算 free`
    const output = await projectHistoricalGuideMessage(message('assistant', original, {
      delivery: { kind: 'travel_guide', status, artifactIds: ['00000000-0000-4000-8000-000000000001'], missing: [], warnings: [], goals: [] },
      artifact_refs: ['00000000-0000-4000-8000-000000000001']
    }), { ...scope, artifacts: { get: async () => record() } })
    expect(output.content).not.toBe(original)
    expect(output.content).not.toContain('符合预算')
    expect(output.content).not.toContain('free')
  })
})
