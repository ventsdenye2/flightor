export type PublicFailureStage = 'provider' | 'output_limit' | 'location' | 'evidence' | 'context_conflict' | 'commit' | 'publication' | 'ui_restore'
export type PublicationLocale = 'zh' | 'en'

const stageForCode = (code: string): PublicFailureStage | undefined => {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(code)) return undefined
  if (['MODEL_OUTPUT_LIMIT', 'model_output_limit', 'output_limit'].includes(code)) return 'output_limit'
  if (/^(?:PROVIDER_|provider_)/.test(code) || ['AUTH', 'INVALID_REQUEST', 'BUDGET', 'SERVER', 'RATE_LIMIT', 'TIMEOUT', 'TRANSPORT', 'model_failure'].includes(code)) return 'provider'
  if (/^(?:PLANNER_CONTEXT_CHANGED|TRIP_CONTEXT_VERSION_CONFLICT|FLIGHT_SELECTION_CHANGED|ARTIFACT_CONTEXT_VERSION_MISMATCH|PUBLICATION_CONTENT_CHANGED|DSH_GUIDE_BASE_UNAVAILABLE|context_conflict)$/.test(code)) return 'context_conflict'
  if (/^(?:CONVERSATION_TURN_NOT_FOUND|CONVERSATION_TURN_TIMEOUT|AGENT_TURN_TIMEOUT|STALE_CONVERSATION_TURN|ui_restore)$/.test(code)) return 'ui_restore'
  if (/(?:LOCATION|PLACE|candidate_location_unresolved)/i.test(code)) return 'location'
  if (/(?:EVIDENCE|SOURCE|missing_material|candidate_evidence_unavailable|candidate_key_unavailable|DSH_CANDIDATE_REFERENCE_UNAVAILABLE)/i.test(code)) return 'evidence'
  if (/^(?:DSH_COMMIT_[A-Z0-9_]+|DSH_ARGUMENT_CORRECTION_LIMIT|DSH_REPAIR_LIMIT|commit)$/.test(code)) return 'commit'
  if (/(?:PUBLICATION|GUIDE_NEEDS_REVISION|publication)/i.test(code)) return 'publication'
  if (['conflict', 'context_budget', 'invalid_plan', 'language', 'format', 'budget_guarantee', 'budget_scope_changed',
    'excluded_precise_claim', 'excluded_admission_or_hours', 'internal_narration', 'unsupported_asset_or_url',
    'duplicated_or_foreign_prose', 'empty_reply'].includes(code)) return 'publication'
  return undefined
}

const copy: Record<PublicFailureStage, Record<PublicationLocale, { message: string; action: string }>> = {
  provider: {
    zh: { message: '规划服务暂时无法完成请求，当前没有确认新的攻略结果。', action: '请先查看行程中已保存的结果，稍后再重试。' },
    en: { message: 'The planning service could not complete this request. No new guide result was confirmed.', action: 'Check the saved results in your trip before trying again later.' }
  },
  output_limit: {
    zh: { message: '本轮内容超出可完成范围，未确认新的攻略发布。', action: '请缩小本次规划或修改范围，再查看行程中的已有结果。' },
    en: { message: 'This request exceeded the response limit, so no new guide was confirmed.', action: 'Narrow the planning or edit request, then check the existing trip results.' }
  },
  location: {
    zh: { message: '暂时无法确认请求中的地点。', action: '请补充所在城市或更具体的地点名称后再继续。' },
    en: { message: 'A requested place could not be confirmed.', action: 'Add its city or a more specific place name before continuing.' }
  },
  evidence: {
    zh: { message: '当前资料不足以支持这项攻略内容。', action: '请补充地点或偏好信息后重试；已有攻略不会因此被确认替换。' },
    en: { message: 'The available source material did not support this guide content.', action: 'Add place or preference details before retrying; no replacement guide was confirmed.' }
  },
  context_conflict: {
    zh: { message: '行程或已选航班在处理期间发生变化，本次结果未覆盖当前内容。', action: '请重新打开当前行程，核对条件后再发送请求。' },
    en: { message: 'The trip or selected flight changed while this request was running, so its result did not replace the current content.', action: 'Reopen the current trip, check its details, and submit a new request.' }
  },
  commit: {
    zh: { message: '攻略提交未能完成，本轮没有确认新的发布结果。', action: '请检查当前行程条件后再提交；不要重复发送前先查看已保存的攻略。' },
    en: { message: 'The guide submission did not complete, and no new publication was confirmed.', action: 'Check the current trip and saved guides before submitting again.' }
  },
  publication: {
    zh: { message: '攻略未通过内容或发布检查，草稿没有作为正式结果显示。', action: '请补齐缺少的行程或资料，再进行修改。' },
    en: { message: 'The guide did not pass content or publication checks, so its draft was not presented as a final result.', action: 'Add the missing itinerary or source details, then revise it.' }
  },
  ui_restore: {
    zh: { message: '本次请求状态暂时无法恢复。', action: '请重新打开行程并检查已保存结果，再决定是否重试。' },
    en: { message: 'The request status could not be restored.', action: 'Reopen the trip and check saved results before deciding whether to retry.' }
  }
}

/** Map only known internal classifications to safe public copy; arbitrary error text is never accepted. */
export function classifyDshFailure(code: string, details: unknown = null): PublicFailureStage | undefined {
  const topLevel = stageForCode(code)
  const inspectDetails = ['DSH_GUIDE_NEEDS_REVISION', 'DSH_TOOL_FAILURE', 'publication'].includes(code)
  if (topLevel && !inspectDetails) return topLevel
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const data = details as Record<string, unknown>
    const repair = data.repair && typeof data.repair === 'object' && !Array.isArray(data.repair)
      ? data.repair as Record<string, unknown> : {}
    const values = [data.code, ...['issues', 'publicationIssues', 'presentationIssues', 'presentationProblems', 'details']
      .flatMap(field => Array.isArray(data[field]) ? data[field] as unknown[] : []),
      ...(Array.isArray(repair.issues) ? repair.issues : [])]
    for (const value of values) {
      if (typeof value === 'string') {
        const stage = stageForCode(value.split(':', 1)[0]!)
        if (stage) return stage
        if (['missing_material', 'candidate_evidence_unavailable'].includes(value)) return 'evidence'
        if (['conflict', 'provider_failure', 'context_budget', 'invalid_plan', 'language', 'format'].includes(value)) return 'publication'
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const issue = value as Record<string, unknown>
        if (typeof issue.code === 'string') {
          const stage = stageForCode(issue.code)
          if (stage) return stage
        }
      }
    }
  }
  return topLevel
}

const unavailableGuideBaseCopy: Record<PublicationLocale, string> = {
  zh: '当前没有可用于局部修改的已发布攻略。请先重新打开当前攻略并完成当前显示语言的准备，再请求局部修改。',
  en: 'There is no published guide available for a local edit. Reopen the current guide and complete preparation in the displayed language before requesting a local edit.'
}

const unavailableCandidateKeyCopy: Record<PublicationLocale, string> = {
  zh: '行程活动与参考资料未能正确关联，本轮未确认新的攻略结果。请先查看行程中已保存的结果，再重试本次请求。',
  en: 'A trip activity could not be correctly linked to its reference material, so no new guide was confirmed. Check the saved results in your trip before retrying this request.'
}

const unresolvedTripLocationCopy: Record<PublicationLocale, string> = {
  zh: '地点尚未与当前行程确认关联，本轮没有确认新的攻略结果。请核对并确认行程目的地信息后再继续。',
  en: 'The place is not yet confirmed against the current trip, so no new guide was confirmed. Check and confirm the trip destination before continuing.'
}

const eventDateEvidenceCopy: Record<PublicationLocale, string> = {
  zh: '活动日期的来源支持尚未确认，本轮未发布新的攻略。请先查看已保存的结果，确认活动日期或选择其他体验后再继续。',
  en: 'Source support for the event dates could not be confirmed. No new guide was published. Check saved results, then confirm the event dates or choose another experience before continuing.'
}

export function publicFailureReply(stage: PublicFailureStage, locale: PublicationLocale, causeCode?: string): string {
  if (stage === 'evidence' && ['candidate_temporal_evidence_missing', 'candidate_temporal_evidence_invalid', 'guide_event_date_evidence_missing'].includes(causeCode ?? ''))
    return eventDateEvidenceCopy[locale]
  if (causeCode === 'DSH_GUIDE_BASE_UNAVAILABLE') return unavailableGuideBaseCopy[locale]
  if (causeCode === 'candidate_key_unavailable') return unavailableCandidateKeyCopy[locale]
  if (causeCode === 'candidate_location_unresolved') return unresolvedTripLocationCopy[locale]
  const value = copy[stage][locale]
  return `${value.message} ${value.action}`
}
