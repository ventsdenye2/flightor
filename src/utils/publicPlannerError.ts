import { ArtifactRequestSupersededError } from '../services/artifactService'

export type PublicPlannerFailureStage = 'provider' | 'output_limit' | 'location' | 'evidence' | 'context_conflict' | 'commit' | 'publication' | 'ui_restore'

const codeStages: Array<[RegExp, PublicPlannerFailureStage]> = [
  [/^(?:MODEL_OUTPUT_LIMIT|model_output_limit|output_limit)$/, 'output_limit'],
  [/^(?:PROVIDER_[A-Z0-9_]+|provider_[a-z0-9_]+|AUTH|INVALID_REQUEST|BUDGET|SERVER|RATE_LIMIT|TIMEOUT|TRANSPORT|model_failure)$/, 'provider'],
  [/^(?:PLANNER_CONTEXT_CHANGED|TRIP_CONTEXT_VERSION_CONFLICT|FLIGHT_SELECTION_CHANGED|ARTIFACT_CONTEXT_VERSION_MISMATCH|PUBLICATION_CONTENT_CHANGED|DSH_GUIDE_BASE_UNAVAILABLE|context_conflict)$/, 'context_conflict'],
  [/^(?:CONVERSATION_TURN_NOT_FOUND|CONVERSATION_TURN_TIMEOUT|AGENT_TURN_TIMEOUT|STALE_CONVERSATION_TURN|ui_restore)$/, 'ui_restore'],
  [/(?:LOCATION|PLACE|candidate_location_unresolved)/i, 'location'],
  [/(?:EVIDENCE|SOURCE|missing_material|candidate_evidence_unavailable|DSH_CANDIDATE_REFERENCE_UNAVAILABLE)/i, 'evidence'],
  [/^(?:DSH_COMMIT_[A-Z0-9_]+|DSH_ARGUMENT_CORRECTION_LIMIT|DSH_REPAIR_LIMIT|commit)$/, 'commit'],
  [/(?:PUBLICATION|GUIDE_NEEDS_REVISION|publication)/i, 'publication']
]

const copy: Record<PublicPlannerFailureStage, { zh: string; en: string }> = {
  provider: {
    zh: '规划服务暂时无法完成请求。请先查看行程中已保存的结果，稍后再重试。',
    en: 'The planning service could not complete this request. Check saved trip results before trying again later.'
  },
  output_limit: {
    zh: '本轮内容超出可完成范围。请缩小规划或修改范围，并先查看行程中的已有结果。',
    en: 'This request exceeded the response limit. Narrow the planning or edit request and check existing trip results first.'
  },
  location: {
    zh: '暂时无法确认请求中的地点。请补充所在城市或更具体的地点名称。',
    en: 'A requested place could not be confirmed. Add its city or a more specific place name.'
  },
  evidence: {
    zh: '当前资料不足以支持这项攻略内容。请补充地点或偏好信息后再试。',
    en: 'The available sources did not support this guide content. Add place or preference details before trying again.'
  },
  context_conflict: {
    zh: '行程或已选航班在处理期间发生变化。请重新打开行程、核对条件后再发送请求。',
    en: 'The trip or selected flight changed during processing. Reopen the trip, check its details, and send a new request.'
  },
  commit: {
    zh: '攻略提交未能完成。请检查当前行程和已保存攻略后再决定是否重试。',
    en: 'The guide submission did not complete. Check the current trip and saved guides before deciding whether to retry.'
  },
  publication: {
    zh: '攻略未通过内容或发布检查。请补齐缺少的行程或资料后再修改。',
    en: 'The guide did not pass content or publication checks. Add the missing itinerary or source details before revising it.'
  },
  ui_restore: {
    zh: '本次请求状态暂时无法恢复。请重新打开行程并检查已保存结果，再决定是否重试。',
    en: 'The request status could not be restored. Reopen the trip and check saved results before deciding whether to retry.'
  }
}

export function publicPlannerFailureStage(code: string): PublicPlannerFailureStage | undefined {
  return codeStages.find(([pattern]) => pattern.test(code))?.[1]
}

export function publicPlannerFailureMessage(code: string, locale: 'zh' | 'en'): string | undefined {
  const stage = publicPlannerFailureStage(code)
  return stage ? copy[stage][locale] : undefined
}

export function publicPlannerRestoreError(error: unknown, locale: 'zh' | 'en'): string | undefined {
  if (error instanceof ArtifactRequestSupersededError) return undefined
  return publicPlannerFailureMessage('ui_restore', locale)
}
