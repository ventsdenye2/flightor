import { z } from 'zod'

// Retrieval and source credibility are not proof of current or trip-date validity.
// No adapter currently supplies a claim-specific validity contract.
export const SOURCE_APPLICABILITY_NOTICE = '以下为来源资料摘要；其中价格、开放时间和交通时长的当前及出行日适用性尚未核实，请以运营方届时公告为准。'
export const sourceApplicabilitySchema = z.object({
  status: z.literal('reference_only'),
  notice: z.literal(SOURCE_APPLICABILITY_NOTICE)
}).strict()

export function sourceApplicability() {
  return { status: 'reference_only' as const, notice: SOURCE_APPLICABILITY_NOTICE }
}
