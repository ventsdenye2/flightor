import { z } from 'zod'

export const publicationLocaleSchema = z.enum(['zh', 'en'])
export type PublicationLocale = z.infer<typeof publicationLocaleSchema>
const prose = (max: number) => z.string().trim().min(1).max(max)
export const finalTextSchema = z.object({
  locale: publicationLocaleSchema,
  reply: prose(1000), overview: prose(2000),
  days: z.array(z.object({ day: z.number().int().positive(), theme: prose(160) }).strict()).min(1).max(60),
  activities: z.array(z.object({
    activityId: prose(160), name: prose(240), introduction: prose(1200), recommendationReason: prose(500),
    sourceRefs: z.array(prose(400)).min(1).max(20)
  }).strict()).min(1).max(360)
}).strict()
export const finalIssueSchema = z.object({
  activityId: z.string().max(160).nullable(),
  code: z.enum(['missing_material', 'conflict', 'invalid_plan', 'language', 'format', 'timeout', 'cancelled', 'stale', 'provider_failure', 'context_budget']),
  detail: prose(500)
}).strict()
export const finalResponseSchema = z.object({
  text: finalTextSchema.nullable(), issues: z.array(finalIssueSchema).max(400)
}).strict()
export const finalVariantSchema = z.object({
  status: z.enum(['accepted', 'blocked']), text: finalTextSchema.nullable(),
  issues: z.array(finalIssueSchema).max(400),
  omitted: z.array(z.string().max(300)).max(100),
  observation: z.object({
    durationMs: z.number().nonnegative(), calls: z.number().int().nonnegative(),
    promptTokens: z.number().nullable(), completionTokens: z.number().nullable(),
    knownCostUsdMicros: z.number().nonnegative(), unknownCostCalls: z.number().int().nonnegative(),
    failure: z.string().nullable(),
    repairReasons: z.array(z.string().max(100)).max(20).optional()
  }).strict()
}).strict()
export const finalizationSchema = z.object({
  version: z.literal(1), variants: z.object({ zh: finalVariantSchema.optional(), en: finalVariantSchema.optional() }).strict()
}).strict()
export type FinalText = z.infer<typeof finalTextSchema>
export type FinalVariant = z.infer<typeof finalVariantSchema>
export type FinalIssue = z.infer<typeof finalIssueSchema>
export const finalPendingReply = (locale: PublicationLocale) => locale === 'en'
  ? 'Your itinerary draft is saved. The final text for this language is not ready.'
  : '行程草稿已保存，当前语言的终稿尚未准备好。'
