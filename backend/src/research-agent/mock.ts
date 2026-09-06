import { createHash } from 'node:crypto'
import { researchArtifactSchema, researchBriefSchema, type ResearchAgent, type ResearchArtifact, type ResearchBrief, type ResearchExecutionContext } from './types.js'

export class MockResearchAgent implements ResearchAgent {
  constructor(private readonly findings: ResearchArtifact['findings'] = []) {}

  async research(brief: ResearchBrief, context: ResearchExecutionContext): Promise<ResearchArtifact> {
    if (context.signal?.aborted) throw context.signal.reason ?? new Error('Research cancelled')
    const validBrief = researchBriefSchema.parse(brief)
    const digest = createHash('sha256').update(JSON.stringify(validBrief)).digest('hex').slice(0, 24)
    return researchArtifactSchema.parse({
      id: `research_${digest}`,
      type: 'research',
      schemaVersion: 1,
      brief: validBrief,
      findings: structuredClone(this.findings).slice(0, validBrief.maxResults ?? 10),
      createdAt: new Date().toISOString()
    })
  }
}
