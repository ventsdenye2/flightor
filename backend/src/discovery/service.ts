import type { AppContext } from '../app/context.js'
import { AppError, isAppError } from '../lib/errors.js'
import { PostgresLocationResolver, type LocationResolver } from '../aviation/location-resolver.js'
import type { LocationRef } from '../aviation/types.js'
import { ProductionResearchAgent } from '../research-agent/production.js'
import type { ResearchAgent, ResearchArtifact } from '../research-agent/types.js'
import { OpenRouterResearchSynthesisModel } from '../providers/openrouter/research.js'
import { PostgresDiscoveryRepository } from './postgres.js'
import { tripTemplateSchema, type DiscoveryInput, type TripTemplate } from './types.js'

export async function resolveDiscoveryLocations(resolver: LocationResolver, codes: readonly string[], signal?: AbortSignal): Promise<LocationRef[]> {
  return Promise.all([...new Set(codes)].map(async code => {
    const result = await resolver.resolveLocation({ query: code, types: ['airport'], limit: 20 }, signal ? { signal } : {})
    const location = result.matches.find(m => m.type === 'airport' && m.iata === code)
    if (!location) throw new AppError('INVALID_DESTINATION', `Canonical airport ${code} was not found`, 400)
    return location
  }))
}
export async function canonicalizeTemplate(resolver: LocationResolver, input: TripTemplate): Promise<TripTemplate> {
  const value = tripTemplateSchema.parse(input)
  const cache = new Map<string, Promise<LocationRef>>()
  const canonical = (loc: LocationRef) => {
    const code = loc.type === 'airport' ? loc.iata : loc.cityCode ?? loc.iata
    if (!code) throw new AppError('INVALID_DESTINATION', 'Choose a canonical airport or city code', 400)
    const key = `${loc.type}:${code}`
    if (!cache.has(key)) cache.set(key, resolver.resolveLocation({ query: code, types: [loc.type], limit: 20 }).then(result => {
      const found = result.matches.find(m => m.type === loc.type && (loc.type === 'airport' ? m.iata === code : (m.cityCode ?? m.iata) === code))
      if (!found) throw new AppError('INVALID_DESTINATION', `Canonical location ${code} was not found`, 400)
      return found
    }))
    return cache.get(key)!
  }
  const [anchorDestinations, optionalDestinations, recommendedStopovers] = await Promise.all([value.anchorDestinations, value.optionalDestinations, value.recommendedStopovers].map(locations => Promise.all(locations.map(canonical))))
  return tripTemplateSchema.parse({ ...value, anchorDestinations, optionalDestinations, recommendedStopovers })
}

/** Template prose comes from the constrained research synthesis; structural
 * fields come from the trusted discovery input, never model-supplied flights. */
export function draftTemplates(research: ResearchArtifact, input: DiscoveryInput, destinations: LocationRef[]): TripTemplate[] {
  const trusted = new Map(destinations.map(d => [d.id, d]))
  return research.findings.slice(0, input.maxResults).map(finding => {
    const anchors = finding.destinations.map(d => trusted.get(d.id)).filter((d): d is LocationRef => Boolean(d))
    if (!anchors.length) throw new AppError('INVALID_RESEARCH_DESTINATION', 'Research referenced a destination outside the brief', 502)
    return tripTemplateSchema.parse({
      title: finding.title.slice(0, 200), summary: finding.summary,
      category: finding.category === 'activity' || finding.category === 'practical' ? 'theme' : finding.category,
      routeConcept: finding.summary, anchorDestinations: anchors, optionalDestinations: [], recommendedStopovers: [],
      suggestedDays: input.suggestedDays, interests: input.interests, experienceGoals: [finding.title],
      validFrom: input.validFrom, validTo: input.validTo,
      sourceFacts: [{ id: finding.id, statement: finding.summary, sourceUrls: finding.sources.map(s => s.url), verification: finding.verification }],
      verification: { ...finding.verification, status: 'unverified', confidence: 0, expiresAt: undefined }
    })
  })
}
export async function executeDiscovery(
  repository: PostgresDiscoveryRepository, resolver: LocationResolver, research: ResearchAgent, runId: string
) {
  const claim = await repository.claimRun(runId)
  if (!claim) return
  try {
    const signal = AbortSignal.timeout(120000)
    const destinations = await resolveDiscoveryLocations(resolver, claim.input.destinationCodes, signal)
    const artifact = await research.research({
      destinations, interests: claim.input.interests,
      questions: [...claim.input.questions, ...(claim.input.instruction ? [`Editorial instruction: ${claim.input.instruction}`] : [])],
      researchTypes: claim.input.researchTypes, travelWindow: { from: claim.input.validFrom, to: claim.input.validTo }, maxResults: claim.input.maxResults
    }, { requestId: runId, signal })
    signal.throwIfAborted()
    if (artifact.warnings.includes('research_synthesis_unavailable_or_invalid')) throw new AppError('DISCOVERY_SYNTHESIS_FAILED', 'Research could not produce relevant reviewed findings', 503)
    if (!artifact.findings.length) throw new AppError('DISCOVERY_NO_FINDINGS', 'No sourced findings were available', 503)
    await repository.finishRun(runId, claim.attempt, draftTemplates(artifact, claim.input, destinations), claim.input)
  } catch (error) {
    const code = isAppError(error) ? error.code : 'DISCOVERY_FAILED'
    await repository.failRun(runId, claim.attempt, code)
    // Job logs only receive a bounded code, not raw provider responses/URLs.
    throw new AppError(code, 'Discovery did not complete; inspect the run status', 503)
  }
}
export function runProductionDiscovery(context: AppContext, runId: string) {
  return executeDiscovery(new PostgresDiscoveryRepository(context.db), new PostgresLocationResolver(context.db), new ProductionResearchAgent(context.providers.researchSearch, new OpenRouterResearchSynthesisModel(context.providers.openrouter, context.env.RESEARCH_MODEL)), runId)
}
