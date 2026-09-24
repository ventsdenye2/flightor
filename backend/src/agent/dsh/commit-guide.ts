import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import { checkpoint, loadWorkspaceArtifact, saveWorkspaceArtifact, type ArtifactWorkspace } from '../../artifacts/workspace.js'
import { researchArtifactSchema, researchTypeSchema, type ResearchArtifact } from '../../research-agent/types.js'
import { travelGuideArtifactPayloadSchema, type TravelGuideArtifactPayload } from '../../travel-guides/artifact.js'
import { authoredGuideInputSchema } from '../../travel-guides/authored.js'
import { guideCandidateRef } from '../../travel-guides/candidates.js'
import { finalTextSchema, type FinalText, type PublicationLocale } from '../../travel-guides/finalization-schema.js'
import { publishIntegratedGuide } from '../../travel-guides/finalization-service.js'
import { sourceRef } from '../../travel-guides/finalization.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { tripTravelWindow } from '../../trips/dates.js'
import { tripRoutePlanPayloadSchema } from '../../trip-planning/types.js'
import { canonicalFingerprint } from '../goals/repository.js'
import { travelGuideGoalParametersSchema } from '../goals/types.js'
import type { AgentTool, ToolExecutionContext } from '../runtime/registry.js'
import { saveTravelGuideTool } from '../tools/authored-travel-guide.js'
import { withGoalIntent } from '../tools/goal-intent.js'
import { canonicalResolvedLocation, recordTripLocations } from '../tools/resolved-locations.js'
import { workspaceScope } from '../tools/workspace-scope.js'
import { convertCandidatesToResearch, type DshEvidenceStore } from './evidence.js'

const key = z.string().trim().min(1).max(120)
const slot = z.enum(['morning', 'afternoon', 'evening', 'flexible'])
const choice = authoredGuideInputSchema.shape.days.element.shape.items.element.omit({ researchIndex: true, findingId: true })
  .extend({ activityKey: key, candidateKey: key.optional(), candidateRef: z.string().min(1).max(160).optional() }).strict()
const daySchema = authoredGuideInputSchema.shape.days.element.extend({ items: z.array(choice).max(6) }).strict()
const activityTextSchema = finalTextSchema.shape.activities.element.omit({ activityId: true, sourceRefs: true }).extend({ activityKey: key }).strict()
export const commitGuideInputSchema = z.object({
  candidates: z.array(z.object({ key, evidenceRefs: z.array(z.string().uuid()).min(1).max(20),
    title: z.string().trim().min(1).max(240), summary: z.string().trim().min(1).max(1500),
    category: researchTypeSchema, locationId: z.string().min(1).max(160) }).strict()).min(1).max(50).optional(),
  days: z.array(daySchema).min(1).max(60),
  supportingRefs: z.array(z.string().min(1).max(160)).max(50).optional(),
  supportingCandidateKeys: z.array(key).max(50).optional(),
  text: finalTextSchema.omit({ locale: true, activities: true }).extend({ activities: z.array(activityTextSchema).max(360) }).strict(),
  baseGuideId: z.string().uuid().optional(), expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  replaceSlots: z.array(z.object({ day: z.number().int().min(1).max(60), slot }).strict()).min(1).max(240).optional()
}).strict()
export type CommitGuideInput = z.infer<typeof commitGuideInputSchema>
type DecisionDay = CommitGuideInput['days'][number]
function fail(message: string, details?: unknown): never { throw new AppError('DSH_GUIDE_NEEDS_REVISION', message, 422, details) }

/** Merge only explicitly selected slots. Untouched day metadata and accepted prose are server-owned. */
export async function mergeProtectedGuide(input: CommitGuideInput, scope: ArtifactWorkspace, locale: PublicationLocale) {
  if (!input.baseGuideId || !input.expectedContentHash || !input.replaceSlots) fail('A local edit requires baseGuideId, expectedContentHash and replaceSlots')
  const record = await loadWorkspaceArtifact(scope, input.baseGuideId, 'travel_guide', [1])
  const guide = travelGuideArtifactPayloadSchema.parse(record.payload)
  const selection = scope.selectedFlight?.selection
  if (Boolean(guide.flightSelection) !== Boolean(selection) || guide.flightSelection && selection &&
    (guide.flightSelection.artifactId !== selection.artifactId || guide.flightSelection.revision !== selection.revision
      || guide.flightSelection.kind !== selection.kind
      || guide.flightSelection.choiceId !== (selection.kind === 'offer' ? selection.offerId : selection.routeId))) {
    throw new AppError('FLIGHT_SELECTION_CHANGED', 'The base guide belongs to a different flight selection', 409)
  }
  const publication = publicationFor(record)
  const accepted = publication?.finalization?.variants[locale]?.text
  if (publication?.guideContentHash !== input.expectedContentHash || !accepted) fail('The base guide content or accepted language changed')
  const selected = new Set(input.replaceSlots.map(item => `${item.day}/${item.slot}`))
  if (selected.size !== input.replaceSlots.length || input.replaceSlots.some(item =>
    !guide.days.some(day => day.day === item.day && day.items.some(activity => activity.timeOfDay === item.slot)))) fail('Replacement slots must identify existing distinct slots')
  if (new Set(input.days.map(day => day.day)).size !== input.days.length || input.days.some(day => !guide.days.some(old => old.day === day.day)
    || day.items.some(item => !selected.has(`${day.day}/${item.timeOfDay}`)))) fail('Replacement input contains a protected day or slot')
  const route = tripRoutePlanPayloadSchema.parse((await loadWorkspaceArtifact(scope, guide.routeArtifactId, 'route', [1])).payload)
  const research = new Map<string, ResearchArtifact>()
  const ref = async (sourceId: string, findingId: string) => {
    let source = research.get(sourceId)
    if (!source) { source = researchArtifactSchema.parse((await loadWorkspaceArtifact(scope, sourceId, 'research', [2])).payload); research.set(sourceId, source) }
    return guideCandidateRef(scope, source, findingId)
  }
  const protectedText = new Map<string, FinalText['activities'][number]>()
  const protectedItems = new Map<string, TravelGuideArtifactPayload['days'][number]['items'][number]>()
  const days: DecisionDay[] = []
  for (const old of guide.days) {
    const supplied = input.days.find(day => day.day === old.day)
    const inserted = new Set<string>()
    const items: DecisionDay['items'] = []
    for (const item of old.items) {
      const timeOfDay = item.timeOfDay ?? 'flexible'
      if (selected.has(`${old.day}/${timeOfDay}`)) {
        if (!inserted.has(timeOfDay)) items.push(...(supplied?.items.filter(next => next.timeOfDay === timeOfDay) ?? []))
        inserted.add(timeOfDay)
      } else {
        const activityKey = `keep:${item.id}`
        const text = accepted.activities.find(activity => activity.activityId === item.id)
        if (!text) fail('The base guide has incomplete accepted activity text')
        protectedText.set(activityKey, text)
        protectedItems.set(activityKey, item)
        items.push({ activityKey, candidateRef: await ref(item.sourceArtifactId, item.sourceFindingId), timeOfDay,
          planningNote: item.planningNote ?? item.description,
          ...(item.reason === 'user_requested' ? { requestedActivityIds: route.days.find(day => day.day === old.day)?.activityRefs.map(value => value.id) ?? [] } : {}) })
      }
    }
    days.push({ day: old.day, cityId: old.city.id, kind: old.kind ?? 'visit', theme: old.theme ?? accepted.days.find(day => day.day === old.day)!.theme,
      ...(old.notes ? { notes: old.notes } : {}), items })
  }
  const supportingRefs = await Promise.all((guide.supportingEvidence ?? []).map(item => ref(item.sourceArtifactId, item.sourceFindingId)))
  if (input.supportingRefs || input.supportingCandidateKeys) fail('A slot edit cannot replace protected supporting evidence')
  return { days, supportingRefs, protectedText, protectedItems, themes: accepted.days }
}

export function createCommitGuideTool(options: { evidenceStore: DshEvidenceStore; locale: PublicationLocale; memoryEnabled?: boolean }): AgentTool {
  const researchCache = new Map<string, ResearchArtifact>()
  const outputSchema = z.object({ status: z.literal('accepted'), artifact: z.object({ id: z.string().uuid(), type: z.literal('travel_guide'), schemaVersion: z.literal(1) }).strict(),
    reply: z.string(), warnings: z.array(z.string()), guideContentHash: z.string(),
    activityBindings: z.array(z.object({ activityKey: z.string(), activityId: z.string(), sourceRefs: z.array(z.string()) }).strict()) }).strict()
  const tool: AgentTool<CommitGuideInput, z.infer<typeof outputSchema>> = {
    name: 'commit_travel_guide',
    description: 'Commit an evidence-backed itinerary and its final text together. New candidates select opaque evidenceRefs from web_search/web_fetch and trusted locationId; existing candidateRef may be reused without new research. Each day item and text activity share a unique activityKey; do not invent source IDs. Text must be in the current locale, with concrete place/action and preference-based reasons, no prices, exact duration, opening hours, budget guarantees or verified-fact claims. To modify only a slot, pass current baseGuideId/expectedContentHash/replaceSlots and only replacement items; the server preserves every other slot and its text. Required Goal intent is accepted before writes; completion happens only after publication accepts.',
    inputSchema: commitGuideInputSchema, outputSchema, costClass: 'cheap', costUnits: 1, sideEffect: 'state', parallelSafe: false, timeoutMs: 30_000, provider: 'travel_guide',
    async execute(input, context, signal) {
      if (!context.ownerId) throw new AppError('UNAUTHORIZED', 'An authenticated owner is required', 401)
      const scopedContext: ToolExecutionContext = { ...context, requireGuideFinalization: true }
      const scope = await workspaceScope(scopedContext, signal)
      recordTripLocations(scopedContext, scope.tripContext)
      if (input.days.some(day => day.items.some(item => Number(Boolean(item.candidateKey)) + Number(Boolean(item.candidateRef)) !== 1))) fail('Each item requires exactly one candidateKey or candidateRef')
      const isPatch = input.baseGuideId !== undefined || input.expectedContentHash !== undefined || input.replaceSlots !== undefined
      const protectedGuide = isPatch ? await mergeProtectedGuide(input, scope, options.locale) : undefined
      const days = protectedGuide?.days ?? input.days
      const decisions = days.flatMap(day => day.items)
      if (new Set(days.map(day => day.day)).size !== days.length || new Set(decisions.map(item => item.activityKey)).size !== decisions.length) fail('Days and activity keys must be unique')
      const authoredTexts = new Map(input.text.activities.map(item => [item.activityKey, item]))
      const needsText = decisions.filter(item => !protectedGuide?.protectedText.has(item.activityKey))
      if (authoredTexts.size !== input.text.activities.length || authoredTexts.size !== needsText.length || needsText.some(item => !authoredTexts.has(item.activityKey))) fail('Text must cover exactly the submitted activities; protected activities cannot be rewritten')
      if (input.candidates && new Set(input.candidates.map(item => item.key)).size !== input.candidates.length) fail('Candidate keys must be unique')
      const candidateRefs = new Map<string, string>()
      if (input.candidates) {
        const goal = context.activeGoalId ? await context.goalRepository?.get(context.activeGoalId) : undefined
        if (!goal || goal.kind !== 'travel_guide') fail('A current travel guide Goal is required')
        const parameters = travelGuideGoalParametersSchema.parse(goal.parameters)
        const candidates = input.candidates.map(({ locationId, ...candidate }) => ({ ...candidate, location: canonicalResolvedLocation(scopedContext, locationId) }))
        const brief = { destinations: [...new Map(candidates.map(item => [item.location.id, item.location])).values()],
          interests: scope.tripContext.interests, questions: parameters.questions, researchTypes: parameters.researchTypes,
          ...(tripTravelWindow(scope.tripContext) ? { travelWindow: tripTravelWindow(scope.tripContext)! } : {}), maxResults: 50 }
        const fingerprint = canonicalFingerprint({ generation: context.generationId, trip: scope.tripId, version: scope.tripContextVersion, candidates, brief })
        let source = researchCache.get(fingerprint)
        if (!source) {
          source = await convertCandidatesToResearch({ candidates, brief, artifactId: randomUUID() }, options.evidenceStore)
          await saveWorkspaceArtifact(scope, { id: source.id, type: 'research', schemaVersion: 2, payload: source, sourceArtifactIds: [] })
          researchCache.set(fingerprint, source)
        }
        for (const candidate of candidates) candidateRefs.set(candidate.key, guideCandidateRef(scope, source, candidate.key))
      }
      const resolveKey = (value: string) => candidateRefs.get(value) ?? fail(`Candidate key is unavailable: ${value}`)
      const saveInput = { days: days.map(day => ({ ...day, items: day.items.map(({ activityKey: _key, candidateKey, ...item }) =>
        ({ ...item, ...(candidateKey ? { candidateRef: resolveKey(candidateKey) } : {}) })) })),
        supportingRefs: protectedGuide?.supportingRefs ?? [...(input.supportingRefs ?? []), ...(input.supportingCandidateKeys ?? []).map(resolveKey)] }
      const saved = await saveTravelGuideTool.execute(saveInput, scopedContext, signal)
      if (saved.status !== 'saved' || !saved.artifact) fail('The itinerary requires revision', saved)
      const record = await context.artifacts.get(saved.artifact.id)
      if (!record) throw new AppError('RESOURCE_NOT_FOUND', 'Saved guide was not found', 404)
      const guide = travelGuideArtifactPayloadSchema.parse(record.payload)
      const items = guide.days.flatMap(day => day.items)
      if (items.length !== decisions.length) fail('Saved activity identity changed unexpectedly')
      const activities = items.map((item, index) => {
        const activityKey = decisions[index]!.activityKey
        const keep = protectedGuide?.protectedText.get(activityKey)
        const original = protectedGuide?.protectedItems.get(activityKey)
        if (original && canonicalFingerprint(item) !== canonicalFingerprint(original)) fail('A protected activity changed during domain validation')
        const text = keep ?? authoredTexts.get(activityKey)!
        return { activityId: item.id, name: text.name, introduction: text.introduction, recommendationReason: text.recommendationReason, sourceRefs: [sourceRef(item)] }
      })
      const text: FinalText = { locale: options.locale, reply: input.text.reply, overview: input.text.overview,
        days: protectedGuide?.themes ?? input.text.days, activities }
      const published = await publishIntegratedGuide({ ownerId: context.ownerId, record, artifacts: context.artifacts, locale: options.locale, text,
        requirements: { trip: scope.tripContext, selectedFlight: context.selectedFlight },
        ...(options.memoryEnabled === undefined ? {} : { memoryEnabled: options.memoryEnabled }), signal, assertCurrent: () => checkpoint(scope) })
      const publication = publicationFor(published)
      const variant = publication?.finalization?.variants[options.locale]
      if (variant?.status !== 'accepted') fail('The final text requires revision', { artifactId: published.id, issues: variant?.issues ?? [] })
      await checkpoint(scope)
      context.onArtifactCommitted?.(published)
      return { status: 'accepted', artifact: saved.artifact, reply: variant.text!.reply, warnings: saved.warnings,
        guideContentHash: publication!.guideContentHash,
        activityBindings: activities.map((item, index) => ({ activityKey: decisions[index]!.activityKey, activityId: item.activityId, sourceRefs: item.sourceRefs })) }
    }
  }
  return withGoalIntent(tool, ['travel_guide'], { required: true, completeAfter: true })
}
