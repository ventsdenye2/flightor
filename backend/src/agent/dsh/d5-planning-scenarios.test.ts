import { describe, expect, it } from 'vitest'
import { runPlanningScenario } from './d5-planning-scenarios.js'

describe('D5 local HTTP planning scenarios through the official worker', () => {
  it.each([1, 2, 3, 4, 5, 6] as const)('case %i publishes one accepted guide with settled simulated billing', async caseNumber => {
    const metrics = await runPlanningScenario(caseNumber, 1)
    expect(metrics).toMatchObject({ caseNumber, simulation: true, accepted: true, delivery: 'satisfied',
      committedGuides: 1, pendingBudgetCalls: 0, researchArtifacts: 1 })
    expect(metrics.modelCalls).toBe(metrics.httpRequests)
    expect(metrics.inputTokens).toBeGreaterThan(0)
    expect(metrics.outputTokens).toBeGreaterThan(0)
    expect(metrics.searchCalls).toBe(0)
    expect(metrics.commitCalls).toBe(caseNumber === 3 || caseNumber === 4 || caseNumber === 5 ? 2 : 1)
    expect(metrics.schemaRepairCount).toBe(caseNumber === 3 ? 1 : 0)
    expect(metrics.semanticRepairCount).toBe(caseNumber === 4 || caseNumber === 5 ? 1 : 0)
    expect(metrics.providerRetries).toBe(caseNumber === 2 || caseNumber === 5 ? 1 : 0)
    if (caseNumber === 6) expect(metrics).toMatchObject({ resumed: true, restoredWithoutWrite: true })
  }, 45_000)
  it('case 10 searches, adopts, binds, edits and restores without another write', async () => {
    const metrics = await runPlanningScenario(10, 1)
    expect(metrics).toMatchObject({ caseNumber: 10, simulation: true, accepted: true, delivery: 'satisfied',
      committedGuides: 2, pendingBudgetCalls: 0, restoredWithoutWrite: true })
    expect(metrics.modelCalls).toBe(metrics.httpRequests)
    expect(metrics.inputTokens).toBeGreaterThan(0)
    expect(metrics.outputTokens).toBeGreaterThan(0)
    expect(metrics.commitCalls).toBe(2)
  }, 45_000)
})
