import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import { checkpoint, saveWorkspaceArtifact } from '../../artifacts/workspace.js'
import { researchArtifactSchema } from '../../research-agent/types.js'
import { travelGuideArtifactPayloadSchema } from '../../travel-guides/artifact.js'
import { tripRoutePlanPayloadSchema } from '../../trip-planning/types.js'
import { validateGuideContent } from '../../travel-guides/validation.js'
import { publicationFor } from '../../travel-guides/publication.js'
import { publishIntegratedGuide } from '../../travel-guides/finalization-service.js'
import type { PublicationLocale } from '../../travel-guides/finalization-schema.js'
import type { TripContext } from '../../trips/types.js'
import { canonicalFingerprint } from '../goals/repository.js'
import { travelGuideGoalParametersSchema } from '../goals/types.js'
import { closeGoalRunAttempt } from '../goals/attempt.js'
import type { ToolExecutionContext } from '../runtime/registry.js'
import { withGoalIntent } from '../tools/goal-intent.js'
import { workspaceScope } from '../tools/workspace-scope.js'

const clauses = (notes: string[]) => notes.flatMap(note => note.split(/[。.!?！？；;]/)).map(value => value.trim()).filter(Boolean)
function budgetClause(value: string): boolean {
  if (!/(?:预算|支出|费用|budget|cost|spending)/i.test(value)) return false
  // A finite vocabulary admits target/scope/caution notes, never places, dates,
  // attractions, transport decisions or a positive affordability assertion.
  if (/(?:保证|承诺|一定|肯定|guarantee|certainly|definitely)/i.test(value)
    && !/(?:不得|不应|不能|不作|不做|不|无法|不要|not|never|no|cannot)/i.test(value)) return false
  return value.toLowerCase().replace(/(?:人民币|日元|美元|预算|目标|全程|整个行程|两天|合计|总支出|支出|总费用|费用|总计|每天|每日|每日|非每日|不得|不能|不应|不要|无法|不作|不做|承诺|保证|一定|肯定|足够|够用|预算内|超出|超支|未知|未核实|尚未核实|不确定|仅为|只是|作为|参考|目标|总|元|非|不|在|是|为|的|内|\b(?:budget|target|total|trip|whole|entire|both|two|days?|daily|per|not|no|never|cannot|do|guarantee|promise|certainly|definitely|within|enough|unknown|unverified|uncertain|costs?|spending|only|a|the|is|for|as|cny|usd|jpy)\b)/g, '')
    .replace(/[\d\s,，:：（）()\-¥￥$€]/g, '') === ''
}
export function isBudgetOnlyGuideChange(before: TripContext, after: TripContext): boolean {
  const stable = ({ budget: _budget, version: _version, notes: _notes, ...value }: TripContext) => value
  if (before.id !== after.id || before.version >= after.version || !before.budget || !after.budget
    || before.budget.scope !== 'trip' || after.budget.scope !== 'trip'
    || canonicalFingerprint(stable(before)) !== canonicalFingerprint(stable(after))) return false
  return budgetNotesEquivalent(before.notes, after.notes)
}
export function budgetNotesEquivalent(before: string[], after: string[]): boolean {
  const nonBudget = (notes: string[]) => clauses(notes).filter(value => !budgetClause(value))
  return canonicalFingerprint(nonBudget(before)) === canonicalFingerprint(nonBudget(after))
}

/** Revalidate an unchanged accepted itinerary after a budget-only Trip update.
 * No model/search calls and no migration of arbitrary cross-version artifacts.
 */
export async function carryForwardBudgetGuide(input: {
  context: ToolExecutionContext; baseGuideId: string; locale: PublicationLocale; memoryEnabled?: boolean; signal: AbortSignal
}) {
  const { context, signal } = input
  signal.throwIfAborted()
  const base = await context.artifacts.get(input.baseGuideId)
  const current = await context.trips.get(context.tripId)
  if (!context.ownerId || !base || base.tripId !== context.tripId || base.conversationId !== context.conversationId
    || base.type !== 'travel_guide' || base.tripContextVersion === undefined || !current) return null
  const previous = await context.trips.getAtVersion?.(context.tripId, base.tripContextVersion)
  if (!previous || !isBudgetOnlyGuideChange(previous, current)) return null
  const publication = publicationFor(base)
  if (publication?.finalization?.variants[input.locale]?.status !== 'accepted') return null
  const originalGoal = base.goalId ? await context.goalRepository?.get(base.goalId) : undefined
  if (!originalGoal || originalGoal.kind !== 'travel_guide' || originalGoal.ownerId !== context.ownerId || originalGoal.tripId !== context.tripId) return null
  const constraints = travelGuideGoalParametersSchema.parse(originalGoal.parameters)
  const guide = travelGuideArtifactPayloadSchema.parse(base.payload)
  const existing = await context.artifacts.listForTrip?.(context.tripId, 100) ?? []
  if (existing.some(record => record.type === 'travel_guide' && record.tripContextVersion === current.version
    && record.conversationId === context.conversationId && publicationFor(record)?.finalization?.variants[input.locale]?.status === 'accepted'
    && canonicalFingerprint(travelGuideArtifactPayloadSchema.parse(record.payload).days.map(day => day.items.map(item => item.id)))
      === canonicalFingerprint(guide.days.map(day => day.items.map(item => item.id))))) return null
  const selected = context.selectedFlight?.selection
  if (Boolean(guide.flightSelection) !== Boolean(selected) || guide.flightSelection && selected
    && (guide.flightSelection.artifactId !== selected.artifactId || guide.flightSelection.revision !== selected.revision
      || guide.flightSelection.kind !== selected.kind || guide.flightSelection.choiceId !== (selected.kind === 'offer' ? selected.offerId : selected.routeId))) return null
  const oldRoute = await context.artifacts.get(guide.routeArtifactId)
  if (!oldRoute || oldRoute.tripId !== context.tripId || oldRoute.tripContextVersion !== previous.version || oldRoute.type !== 'route') return null
  const route = tripRoutePlanPayloadSchema.parse(oldRoute.payload)
  const researchIds = [...new Set([...guide.days.flatMap(day => day.items), ...(guide.supportingEvidence ?? [])].map(item => item.sourceArtifactId))]
  const sources = await Promise.all(researchIds.map(id => context.artifacts.get(id)))
  if (sources.some(record => !record || record.type !== 'research' || record.tripId !== context.tripId || record.tripContextVersion !== previous.version)) return null
  const planned = sources.map(record => ({ original: record!, id: randomUUID(), research: researchArtifactSchema.parse(record!.payload) }))
  const mapping = new Map(planned.map(value => [value.original.id, value.id]))
  const remap = (id: string) => mapping.get(id) ?? id
  const nextRouteId = randomUUID()
  const nextRoute = tripRoutePlanPayloadSchema.parse({ ...route, tripContextVersion: current.version, sourceArtifactIds: route.sourceArtifactIds.map(remap) })
  const { publication: _oldPublication, ...plainGuide } = guide
  const nextGuide = travelGuideArtifactPayloadSchema.parse({ ...plainGuide, routeArtifactId: nextRouteId,
    sourceArtifactIds: guide.sourceArtifactIds.map(id => id === oldRoute.id ? nextRouteId : remap(id)),
    days: guide.days.map(day => ({ ...day, items: day.items.map(item => ({ ...item, sourceArtifactId: remap(item.sourceArtifactId) })) })),
    ...(guide.supportingEvidence ? { supportingEvidence: guide.supportingEvidence.map(item => ({ ...item, sourceArtifactId: remap(item.sourceArtifactId) })) } : {}),
    budget: { ...current.budget!, partyBasis: 'unspecified', period: 'trip_total' }, createdAt: new Date().toISOString() })
  const research = new Map(planned.map(value => [value.id, { ...value.research, id: value.id }]))
  const validation = validateGuideContent({ guide: nextGuide, route: nextRoute, research, trip: current, constraints })
  if (validation.status !== 'satisfied') return null
  // Separate explicit derivative operation; never reuse a satisfied historical
  // Goal or modify a trip-context-update Goal's accepted parameters.
  const derivativeContext = { ...context, requestId: `${context.requestId}:budget-guide:${base.id}:${current.version}` }
  delete derivativeContext.activeGoalId; delete derivativeContext.activeGoalRunId; delete derivativeContext.activeGoalKind
  delete derivativeContext.activeGoalContextVersion; delete derivativeContext.acceptedGoalIntent
  delete derivativeContext.guideDraft
  const operation = withGoalIntent({ name: 'carry_forward_budget_guide', description: 'Revalidate unchanged itinerary after an explicit total-budget update.',
    inputSchema: z.object({}).strict(), outputSchema: z.object({ status: z.literal('accepted'), artifact: z.object({ id: z.string(), type: z.literal('travel_guide'), schemaVersion: z.literal(1) }) }),
    costClass: 'cheap', costUnits: 0, sideEffect: 'state', parallelSafe: false, timeoutMs: 30_000, provider: 'travel_guide',
    async execute(_args, ctx, operationSignal) {
      const { onArtifactCommitted: _onArtifactCommitted, ...withoutPublication } = ctx
      const scope = await workspaceScope({ ...withoutPublication, requireGuideFinalization: true }, operationSignal)
      for (const item of planned) {
        await checkpoint(scope)
        await context.artifacts.create({ id: item.id, tripId: context.tripId, conversationId: context.conversationId,
          goalId: ctx.activeGoalId!, runId: ctx.activeGoalRunId!, tripContextVersion: current.version, type: 'research', schemaVersion: 2,
          payload: research.get(item.id)!, sourceArtifactIds: [item.original.id],
          isSourceContextCompatible: source => source.id === item.original.id && source.tripId === context.tripId
            && source.tripContextVersion === previous.version && canonicalFingerprint(source.payload) === canonicalFingerprint(item.original.payload) })
      }
      await saveWorkspaceArtifact(scope, { id: nextRouteId, type: 'route', schemaVersion: 1, payload: nextRoute, sourceArtifactIds: nextRoute.sourceArtifactIds })
      let record = await saveWorkspaceArtifact(scope, { type: 'travel_guide', schemaVersion: 1, payload: nextGuide, sourceArtifactIds: nextGuide.sourceArtifactIds })
      for (const locale of ['zh', 'en'] as const) {
        const text = publication.finalization!.variants[locale]?.text
        if (publication.finalization!.variants[locale]?.status !== 'accepted' || !text) continue
        record = await publishIntegratedGuide({ ownerId: context.ownerId!, record, artifacts: context.artifacts, locale,
          text: { ...text, activities: text.activities.map(activity => ({ ...activity, sourceRefs: activity.sourceRefs.map(ref => {
            const slash = ref.indexOf('/'); return `${remap(ref.slice(0, slash))}${ref.slice(slash)}`
          }) })) }, requirements: { trip: current, selectedFlight: context.selectedFlight }, signal: operationSignal,
          ...(input.memoryEnabled === undefined ? {} : { memoryEnabled: input.memoryEnabled }), assertCurrent: () => checkpoint(scope) })
        if (publicationFor(record)?.finalization?.variants[locale]?.status !== 'accepted') throw new AppError('DSH_BUDGET_GUIDE_PUBLICATION_BLOCKED', 'Budget carry-forward publication failed', 422)
      }
      await checkpoint(scope)
      context.onArtifactCommitted?.(record)
      return { status: 'accepted' as const, artifact: { id: record.id, type: 'travel_guide' as const, schemaVersion: 1 as const } }
    }
  }, ['travel_guide'], { required: true, completeAfter: true })
  try {
    return await operation.execute(operation.inputSchema.parse({ intent: { kind: 'travel_guide', parameters: constraints } }), derivativeContext, signal)
  } catch (error) {
    if (derivativeContext.activeGoalId && derivativeContext.activeGoalRunId && context.goalRunRepository) {
      await closeGoalRunAttempt({ ownerId: context.ownerId, tripId: context.tripId, generationId: context.generationId, runs: context.goalRunRepository },
        { goalId: derivativeContext.activeGoalId, runId: derivativeContext.activeGoalRunId, status: signal.aborted ? 'cancelled' : 'failed' })
    }
    throw error
  }
}
