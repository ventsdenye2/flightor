import { describe, expect, it } from 'vitest'
import { requiredGuideEvidenceTypes, travelGuideGoalParametersSchema } from './types.js'

const base = {
  questions: ['Plan the trip'],
  researchTypes: ['activity', 'practical', 'event'] as const,
  maxResults: 10,
  maxCities: 1,
  allowPartial: true
}

describe('travel guide evidence requirements', () => {
  it('keeps legacy researchTypes strictly required when the new field is absent', () => {
    const parsed = travelGuideGoalParametersSchema.parse({ ...base, researchTypes: ['activity', 'event'] })
    expect(requiredGuideEvidenceTypes(parsed)).toEqual(['activity', 'event'])
  })

  it('allows event exploration without making event evidence required', () => {
    const parsed = travelGuideGoalParametersSchema.parse({ ...base, requiredEvidenceTypes: ['activity'] })
    expect(requiredGuideEvidenceTypes(parsed)).toEqual(['activity'])
  })

  it('accepts explicit event requirements and explicit empty requirements', () => {
    expect(travelGuideGoalParametersSchema.parse({ ...base, requiredEvidenceTypes: ['event'] }).requiredEvidenceTypes).toEqual(['event'])
    const empty = travelGuideGoalParametersSchema.parse({ ...base, requiredEvidenceTypes: [] })
    expect(requiredGuideEvidenceTypes(empty)).toEqual([])
  })

  it('rejects required evidence outside the exploration set', () => {
    expect(travelGuideGoalParametersSchema.safeParse({ ...base, researchTypes: ['activity'], requiredEvidenceTypes: ['event'] }).success).toBe(false)
  })

  it('does not mutate the input arrays or return an aliased array', () => {
    const researchTypes = ['activity', 'practical'] as const
    const requiredEvidenceTypes = ['practical'] as const
    const input = { researchTypes: [...researchTypes], requiredEvidenceTypes: [...requiredEvidenceTypes] }
    const before = JSON.stringify(input)
    const result = requiredGuideEvidenceTypes(input)
    result.push('activity')
    expect(JSON.stringify(input)).toBe(before)
    expect(result).toEqual(['practical', 'activity'])
  })
})
