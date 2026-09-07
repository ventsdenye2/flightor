import { AppError } from '../lib/errors.js'
import type { ResearchAgent, ResearchBrief, ResearchExecutionContext, ResearchArtifact } from './types.js'

/** Explicit capability seam used when production web research is not configured. */
export class UnavailableResearchAgent implements ResearchAgent {
  async research(_brief: ResearchBrief, _context: ResearchExecutionContext): Promise<ResearchArtifact> {
    throw new AppError('RESEARCH_UNAVAILABLE', 'Web research is unavailable', 503)
  }
}
