import { z } from 'zod'
import { AppError } from '../lib/errors.js'
import { researchBriefSchema } from './types.js'

export const MAX_RESEARCH_SEARCH_TASKS = 8
export const MAX_RESEARCH_SEARCH_TERMS_LENGTH = 120

/** Retrieval text is not an authority channel for URLs, operators or source metadata. */
export const researchSearchTermsSchema = z.string().trim().min(1).max(MAX_RESEARCH_SEARCH_TERMS_LENGTH)
  .regex(/^[\p{L}\p{N}\s'’&,-]+$/u, 'Search terms must be plain words')
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value)
    && !/\b(?:AND|OR|NOT)\b/i.test(value)
    && !/(?:^|\s)-\S/.test(value)
    && value.split(/\s+/).length <= 12, 'Search terms must be short words without URLs or operators')

const queryTaskSchema = z.object({
  destinationIndex: z.number().int().nonnegative(),
  questionIndex: z.number().int().nonnegative()
}).strict()

export const researchQueryPlanInputSchema = z.object({
  brief: researchBriefSchema,
  tasks: z.array(queryTaskSchema).min(1).max(MAX_RESEARCH_SEARCH_TASKS)
}).strict().superRefine((input, context) => {
  const seen = new Set<string>()
  for (const [index, task] of input.tasks.entries()) {
    const key = taskKey(task)
    if (task.destinationIndex >= input.brief.destinations.length
      || task.questionIndex >= input.brief.questions.length || seen.has(key)) {
      context.addIssue({ code: 'custom', message: 'Research task must reference a unique brief destination/question', path: ['tasks', index] })
    }
    seen.add(key)
  }
})

export const researchQueryPlanSchema = z.object({
  queries: z.array(queryTaskSchema.extend({ searchTerms: researchSearchTermsSchema })).min(1).max(MAX_RESEARCH_SEARCH_TASKS)
}).strict()

export type ResearchQueryTask = z.infer<typeof queryTaskSchema>
export type ResearchQueryPlanInput = z.infer<typeof researchQueryPlanInputSchema>
export type ResearchPlannedQuery = z.infer<typeof researchQueryPlanSchema>['queries'][number]

export interface ResearchQueryPlanner {
  plan(input: ResearchQueryPlanInput, options?: { signal?: AbortSignal }): Promise<ResearchPlannedQuery[]>
}

function taskKey(task: ResearchQueryTask): string {
  return `${task.destinationIndex}:${task.questionIndex}`
}

/** The domain fixes tasks and coverage; the model can only phrase one short query per task. */
export function validateResearchQueryPlan(input: ResearchQueryPlanInput, output: unknown): ResearchPlannedQuery[] {
  const requested = researchQueryPlanInputSchema.parse(input)
  const parsed = researchQueryPlanSchema.safeParse(output)
  if (!parsed.success || parsed.data.queries.length !== requested.tasks.length) {
    throw new AppError('RESEARCH_QUERY_PLAN_INVALID', 'Research query plan did not match the bounded tasks', 502)
  }
  const expected = new Set(requested.tasks.map(taskKey))
  const selected = new Map<string, ResearchPlannedQuery>()
  for (const query of parsed.data.queries) {
    const key = taskKey(query)
    if (!expected.has(key) || selected.has(key)) {
      throw new AppError('RESEARCH_QUERY_PLAN_INVALID', 'Research query plan contained an invalid task reference', 502)
    }
    selected.set(key, query)
  }
  return requested.tasks.map(task => selected.get(taskKey(task))!)
}
