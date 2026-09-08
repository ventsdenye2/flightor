import { describe, expect, it } from 'vitest'
import { validateResearchQueryPlan, type ResearchQueryPlanInput } from './query-planner.js'

const input: ResearchQueryPlanInput = {
  brief: {
    destinations: [{ id: 'city-a', type: 'city', name: 'City A', countryCode: 'FR' }],
    interests: ['culture'], questions: ['What museums are worth visiting?', 'What food markets are worth visiting?'], researchTypes: ['activity']
  },
  tasks: [{ destinationIndex: 0, questionIndex: 0 }, { destinationIndex: 0, questionIndex: 1 }]
}
const first = { destinationIndex: 0, questionIndex: 0, searchTerms: 'art museums' }
const second = { destinationIndex: 0, questionIndex: 1, searchTerms: 'food markets' }

describe('ResearchQueryPlanner domain contract', () => {
  it('accepts only the selected tasks and restores their deterministic order', () => {
    expect(validateResearchQueryPlan(input, { queries: [second, first] })).toEqual([first, second])
  })

  it.each([
    { queries: [first] },
    { queries: [first, first] },
    { queries: [first, second, { ...second, questionIndex: 2 }] },
    { queries: [{ ...first, destinationIndex: 1 }, second] },
    { queries: [{ ...first, questionIndex: 99 }, second] },
    { queries: [{ ...first, destinationIndex: 0.5 }, second] },
    { queries: [{ ...first, source: 'official' }, second] },
    { queries: [first, second], sources: [{ url: 'https://invented.example' }] }
  ])('rejects changed task coverage, indices or authority fields: %j', output => {
    expect(() => validateResearchQueryPlan(input, output)).toThrow(expect.objectContaining({ code: 'RESEARCH_QUERY_PLAN_INVALID' }))
  })

  it.each([
    '', 'https://example.com/museum', 'www.example.com', 'example.com museums',
    'site:example.com museums', 'museums OR parks', 'museums -parks', 'museum +free',
    '"art museum"', 'museums\nparks', 'a '.repeat(13).trim(), 'a'.repeat(121)
  ])('rejects URL, operator or unbounded retrieval wording: %s', searchTerms => {
    expect(() => validateResearchQueryPlan(input, { queries: [{ ...first, searchTerms }, second] }))
      .toThrow(expect.objectContaining({ code: 'RESEARCH_QUERY_PLAN_INVALID' }))
  })
})
