import type { ArtifactRecord } from '../artifacts/repository.js'
import { createHash } from 'node:crypto'
import { researchArtifactSchema, type ResearchArtifact } from '../research-agent/types.js'
import { supportedClaimEvidence, hasClaimConflict } from '../research-agent/claim-evidence.js'
import { travelGuideArtifactPayloadSchema, type TravelGuideArtifactPayload } from './artifact.js'
import { guidePublicationSchema, type GuidePublication } from './publication-schema.js'
import { sourceApplicability } from './source-applicability.js'
import { finalPendingReply, type PublicationLocale } from './finalization-schema.js'

export const GUIDE_LEGACY_REPLY = '此前保存的攻略仍可查看。旧版文字未逐项审查，费用、开放时间及交通耗时待核实，不能确认是否满足预算。'
const UNKNOWN = '建议时段仅表示安排意向；费用、开放时间、预约要求和交通耗时待核实。'
const referenceKey = (item: { sourceArtifactId: string; sourceFindingId: string }) => JSON.stringify([item.sourceArtifactId, item.sourceFindingId])
/** Future media/map enrichment is a separate projection keyed to content + activity,
 * never a mutation of the guide prose or its business/content version. */
export function guideEnrichmentKey(record: ArtifactRecord, activityId: string): { contentVersion: string; activityId: string } | undefined {
  const guide = travelGuideArtifactPayloadSchema.safeParse(record.payload)
  const publication = publicationFor(record)
  return guide.success && publication && guide.data.days.some(day => day.items.some(item => item.id === activityId))
    ? { contentVersion: publication.guideContentHash, activityId } : undefined
}
function guideContentHash(guide: TravelGuideArtifactPayload): string {
  const { publication: _publication, ...content } = guide
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}
const safeUrl = (value: string): boolean => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

/** Literal retrieval, not entity recognition or fact classification. A candidate's
 * leading phrase may locate a useful source excerpt; it is always labelled a quote.
 * No match means no model-authored label is published. */
function sourceLabel(title: string, source: ResearchArtifact['findings'][number]['sources'][number]) {
  const parts = title.trim().split(/\s+/).slice(0, 30)
  const candidates = Array.from({ length: parts.length }, (_, index) => parts.slice(0, parts.length - index).join(' '))
    .filter(value => value.length >= 2 && value.length <= 160 && (value.includes(' ') || !/[A-Za-z]/.test(value)))
  // Unspaced names need the same literal prefix lookup; never publish an unmatched suffix.
  if (/[^\x00-\x7f]/.test(title)) {
    for (let length = Math.min(title.length, 160); length >= 2; length--) candidates.push(title.slice(0, length))
  }
  const pageText = source.page && createHash('sha256').update(source.page.text).digest('hex') === source.page.contentHash
    ? source.page.text : undefined
  const texts = [{ text: source.title, basis: 'source_title' as const },
    { text: pageText, basis: 'page_excerpt' as const }, { text: source.snippet, basis: 'search_excerpt' as const }]
  for (const candidate of candidates) {
    for (const { text, basis } of texts) {
      if (text?.includes(candidate)) return { labelQuote: candidate, labelBasis: basis }
    }
  }
  return {}
}

/** No cost ledger exists yet. A preserved constraint never establishes affordability. */
function budgetAssessment(guide: TravelGuideArtifactPayload): GuidePublication['budgetAssessment'] {
  const budget = guide.budget
  const scope = budget?.scope === 'airfare' ? '机票' : budget?.scope === 'transport' ? '交通' : '行程'
  return { status: 'undetermined', knownSubtotal: null, scopeCoverage: 'incomplete',
    notice: `${budget ? `已记录${scope}总预算目标 ${budget.amount} ${budget.currency}。` : '尚未记录预算目标。'}费用与人数口径尚未完整核实，目前不能确认总支出是否满足预算。` }
}

/** Called only at the domain write boundary with owner/version checked research.
 * Model titles, summaries and planning notes are audit data, not public prose.
 * Provider document titles and exact body excerpts are explicitly attributed references,
 * never reviewed venue identities or future prices. No semantic review is inferred. */
export function buildGuidePublication(record: Pick<ArtifactRecord, 'id' | 'tripContextVersion'>,
  guide: TravelGuideArtifactPayload, research: readonly ResearchArtifact[] = [], legacy = false): GuidePublication {
  const references: GuidePublication['references'] = {}
  for (const item of [...guide.days.flatMap(day => day.items), ...(guide.supportingEvidence ?? [])]) {
    const source = research.find(value => value.id === item.sourceArtifactId)
    const finding = source?.findings.find(value => value.id === item.sourceFindingId)
    const claims = finding?.claimEvidence ?? []
    references[referenceKey(item)] = (finding?.sources ?? []).filter(source => safeUrl(source.url)).map((source, index) => ({
      url: source.url, title: source.title, ...sourceLabel(finding!.title, source),
      excerpts: hasClaimConflict(claims) ? [] : [...claims.filter(claim => claim.sourceUrl === source.url
        && supportedClaimEvidence(claim, finding!.sources)).map(claim => ({ quote: claim.quote, retrievedAt: claim.retrievedAt })),
        ...(claims.length === 0 && index === 0 && source.snippet ? [{
          quote: source.snippet.slice(0, 800), retrievedAt: finding!.verification.checkedAt,
          basis: 'search_excerpt' as const,
          contentHash: createHash('sha256').update(source.snippet.slice(0, 800)).digest('hex')
        }] : [])]
    }))
  }
  const assessment = budgetAssessment(guide)
  return guidePublicationSchema.parse({ version: 1, artifactId: record.id, tripContextVersion: record.tripContextVersion ?? 0,
    guideContentHash: guideContentHash(guide),
    ...(guide.flightSelection ? { flightSelectionRevision: guide.flightSelection.revision } : {}),
    contentContract: 'limited', evidenceCoverage: Object.values(references).some(value => value.length) ? 'partial' : 'unknown',
    legacy, references, budgetAssessment: assessment,
    reply: legacy ? GUIDE_LEGACY_REPLY : `已保存 ${guide.days.length} 天的安排。请查看结果卡片中的建议时段与来源资料；来源标题和摘录不代表已确认出行日适用。${assessment.notice}` })
}

export function publicationFor(record: ArtifactRecord): GuidePublication | undefined {
  const parsed = travelGuideArtifactPayloadSchema.safeParse(record.payload)
  if (record.type !== 'travel_guide' || record.schemaVersion !== 1 || !parsed.success) return undefined
  const guide = parsed.data
  const candidate = guidePublicationSchema.safeParse(guide.publication)
  if (candidate.success && candidate.data.artifactId === record.id
    && candidate.data.guideContentHash === guideContentHash(guide)
    && candidate.data.tripContextVersion === record.tripContextVersion
    && candidate.data.flightSelectionRevision === guide.flightSelection?.revision) return candidate.data
  return buildGuidePublication(record, guide, [], true)
}

export function guidePublicationReply(record: ArtifactRecord, locale: PublicationLocale = 'zh'): string {
  const publication = publicationFor(record)
  if (publication?.finalization) return publication.finalization.variants[locale]?.text?.reply ?? finalPendingReply(locale)
  if (locale === 'en') return finalPendingReply(locale)
  return publication?.reply ?? GUIDE_LEGACY_REPLY
}

/** Public copies omit raw prose; stored artifacts remain intact for verifier and audit. */
export function projectGuideRecord(record: ArtifactRecord, locale: PublicationLocale = 'zh'): ArtifactRecord {
  if (record.type !== 'travel_guide') return record
  const parsed = travelGuideArtifactPayloadSchema.safeParse(record.payload)
  const publication = publicationFor(record)
  if (!parsed.success || !publication) return { ...record, verification: undefined,
    payload: { kind: 'trip_travel_guide', schemaVersion: 1, days: [], warnings: ['guide_publication_unavailable'] } }
  const guide = parsed.data
  if (publication.finalization || locale === 'en') {
    const variant = publication.finalization?.variants[locale]
    const accepted = variant?.status === 'accepted' ? variant.text : null
    const publicPublication = { ...publication, finalization: undefined, locale,
      canLocalize: Object.values(publication.finalization?.variants ?? {}).some(value => value?.status === 'accepted'),
      status: accepted ? 'accepted' : variant ? 'blocked' : 'preparing',
      issues: variant?.issues ?? [], reply: accepted?.reply ?? finalPendingReply(locale), overview: accepted?.overview,
      budgetAssessment: { ...publication.budgetAssessment, notice: locale === 'en' ? 'Budget is a target; total costs have not been established.' : '预算为目标口径，尚未核定总费用。' } }
    return { ...record, verification: undefined, payload: {
      kind: guide.kind, schemaVersion: guide.schemaVersion, builderVersion: guide.builderVersion,
      routeArtifactId: guide.routeArtifactId, sourceArtifactIds: guide.sourceArtifactIds,
      flightSelection: guide.flightSelection, budget: guide.budget, createdAt: guide.createdAt,
      publication: publicPublication, warnings: accepted ? [] : ['guide_finalization_pending'],
      days: accepted ? guide.days.map(day => ({ day: day.day, city: day.city, kind: day.kind,
        theme: accepted.days.find(value => value.day === day.day)?.theme,
        items: day.items.map(item => {
          const text = accepted.activities.find(value => value.activityId === item.id)!
          return { id: item.id, title: text.name, description: text.introduction, planningNote: text.recommendationReason,
            recommendationReason: text.recommendationReason, city: item.city, category: item.category, reason: item.reason,
            timeOfDay: item.timeOfDay, sourceArtifactId: item.sourceArtifactId, sourceFindingId: item.sourceFindingId }
        }) })) : [], supportingEvidence: [], unassignedActivityRefs: []
    } }
  }
  const projectItem = <T extends { sourceArtifactId: string; sourceFindingId: string; category: string }>(item: T) => {
    const refs = publication.references[referenceKey(item)] ?? []
    const labelled = refs.find(ref => ref.labelQuote)
    const title = labelled ? `来源条目摘录：${labelled.labelQuote}`
      : refs[0] ? `资料标题：${refs[0].title.slice(0, 230)}` : '已保存的活动（资料待核实）'
    const excerpts = refs.flatMap(ref => ref.excerpts.filter(excerpt => !excerpt.basis ||
      excerpt.contentHash === createHash('sha256').update(excerpt.quote).digest('hex'))
      .map(excerpt => `${excerpt.basis === 'search_excerpt' ? '搜索摘要参考（非网页正文）' : '来源原文摘录'}（${excerpt.retrievedAt} 记录；主体、条件及出行日适用性未审查；来源：${ref.url}）：「${excerpt.quote}」`)).slice(0, 1)
    const labelNotice = labelled ? `条目名称摘自${labelled.labelBasis === 'page_excerpt' ? '网页正文' : labelled.labelBasis === 'search_excerpt' ? '搜索摘要' : '来源标题'}，未作独立身份核实。` : ''
    return { title, description: `${labelNotice}${UNKNOWN}${excerpts.length ? `\n${excerpts.join('\n')}` : ''}`,
      sourceArtifactId: item.sourceArtifactId, sourceFindingId: item.sourceFindingId, category: item.category,
      sourceApplicability: sourceApplicability(), verification: { status: 'unverified', confidence: 0, checkedAt: guide.createdAt,
        sources: refs.map(ref => ({ provider: 'source_reference', reference: ref.url })) } }
  }
  return { ...record, verification: { status: 'unverified', confidence: 0, checkedAt: guide.createdAt, sources: [] }, payload: {
    kind: guide.kind, schemaVersion: guide.schemaVersion, builderVersion: guide.builderVersion,
    routeArtifactId: guide.routeArtifactId, sourceArtifactIds: guide.sourceArtifactIds,
    ...(guide.flightSelection ? { flightSelection: guide.flightSelection } : {}),
    days: guide.days.map(day => ({ day: day.day, city: day.city, kind: day.kind,
      theme: day.kind === 'rest' ? '休息与自由安排' : day.kind === 'travel' ? '交通与衔接安排' : '建议游览安排',
      items: day.items.map(item => ({ ...projectItem(item), id: item.id, city: item.city, reason: item.reason, timeOfDay: item.timeOfDay })) })),
    supportingEvidence: (guide.supportingEvidence ?? []).map(item => ({ ...projectItem(item), destinations: item.destinations })),
    ...(guide.budget ? { budget: guide.budget } : {}), unassignedActivityRefs: [],
    verification: { status: 'unverified', confidence: 0, checkedAt: guide.createdAt, sources: [] },
    warnings: [publication.legacy ? 'legacy_guide_publication_limited' : 'guide_publication_limited'], createdAt: guide.createdAt, publication
  } }
}

export function admittedResearch(records: readonly ArtifactRecord[]): ResearchArtifact[] {
  return records.flatMap(record => {
    const parsed = record.type === 'research' && record.schemaVersion === 2 ? researchArtifactSchema.safeParse(record.payload) : undefined
    return parsed?.success && parsed.data.id === record.id ? [parsed.data] : []
  })
}
