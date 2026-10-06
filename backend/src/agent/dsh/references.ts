import { createHash } from 'node:crypto'
import { candidateArtifactId } from '../../travel-guides/candidates.js'

export interface DshReferenceScope {
  ownerId: string
  tripId: string
  conversationId: string
  generationId: string
  tripContextVersion: number
}

function scopeToken(scope: DshReferenceScope): string {
  return createHash('sha256')
    .update(JSON.stringify([scope.ownerId, scope.tripId, scope.conversationId, scope.generationId, scope.tripContextVersion]))
    .digest('hex').slice(0, 10)
}

/** Per-turn aliases for persisted candidates. The domain still validates the original gc1 reference. */
export class DshReferences {
  private readonly token: string
  private readonly candidateToShort = new Map<string, string>()
  private readonly shortToCandidate = new Map<string, string>()
  private sequence = 0

  constructor(scope: DshReferenceScope) {
    this.token = scopeToken(scope)
  }

  registerCandidate(candidateRef: string): string | undefined {
    if (!candidateArtifactId(candidateRef)) return undefined
    const existing = this.candidateToShort.get(candidateRef)
    if (existing) return existing
    const shortRef = `C-${this.token}-${++this.sequence}`
    this.candidateToShort.set(candidateRef, shortRef)
    this.shortToCandidate.set(shortRef, candidateRef)
    return shortRef
  }

  resolveCandidate(candidateRef: string): string | undefined {
    return this.shortToCandidate.get(candidateRef)
      ?? (candidateArtifactId(candidateRef) ? candidateRef : undefined)
  }
}
