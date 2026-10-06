import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import { CommitRecovery, classifyCommitFailure, safeCommitFeedback } from './commit-recovery.js'

describe('DSH commit recovery policy', () => {
  it('gives a field-specific correction for a source URL used as a persisted candidate reference', () => {
    const error = new AppError('DSH_CANDIDATE_REFERENCE_UNAVAILABLE', 'PRIVATE_PROVIDER_BODY', 409,
      { fieldPath: 'supportingRefs.0', reference: 'https://private.test/?token=secret' })
    const kind = classifyCommitFailure(error)
    expect(kind).toBe('prerequisite')
    const feedback = safeCommitFeedback(error, kind)
    expect(feedback.fields).toEqual(['supportingRefs.0'])
    expect(feedback.instruction).toContain('candidate references')
    expect(feedback.instruction).toContain('supportingCandidateKeys')
    expect(feedback.instruction).toContain('not source URLs')
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_PROVIDER_BODY|private\.test|token=secret/)
    const recovery = new CommitRecovery()
    recovery.admit(); recovery.failed(error)
    expect(recovery.snapshot()).toMatchObject({ calls: 1, contentAttempts: 0, lastFailure: 'prerequisite' })
  })
  it('classifies out-of-Goal candidate categories as bounded argument corrections without exposing submitted values', () => {
    const secret = 'PRIVATE_CANDIDATE_OR_SOURCE'
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', secret, 422, {
      code: 'candidate_category_outside_goal', fieldPath: 'candidates.7.category', candidateIndex: 7,
      allowedCategories: ['activity', 'practical', 'private-category'], candidateKey: secret,
      rejectedCategory: 'event', providerBody: secret
    })
    const kind = classifyCommitFailure(error)
    expect(kind).toBe('arguments')
    const feedback = safeCommitFeedback(error, kind)
    expect(feedback).toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', kind: 'arguments',
      candidateIndex: 7, fieldPath: 'candidates.7.category', allowedCategories: ['activity', 'practical'] })
    expect(feedback.correction).toContain('Keep the accepted Goal unchanged')
    expect(feedback.correction).toContain('do not relabel unsupported material')
    expect(feedback).not.toHaveProperty('candidateKey')
    expect(feedback).not.toHaveProperty('rejectedCategory')
    expect(JSON.stringify(feedback)).not.toContain(secret)
    const recovery = new CommitRecovery()
    recovery.admit(); recovery.failed(error)
    expect(recovery.snapshot()).toMatchObject({ calls: 1, argumentCorrections: 1, contentAttempts: 0, lastFailure: 'arguments' })
  })
  it('explains source-reference parameter errors without copying submitted source text', () => {
    const error = new z.ZodError([{ code: 'custom', path: ['candidates', 0, 'sourceRefs', 0], message: 'PRIVATE_SOURCE_BODY' }])
    const feedback = safeCommitFeedback(error, 'arguments', { acceptedGoal: false })
    expect(feedback.fields).toEqual(['candidates.0.sourceRefs.0'])
    expect(feedback.correction).toContain('sourceRefs returned by web_search/web_fetch')
    expect(feedback.correction).toContain('not URLs')
    expect(feedback.instruction).toContain('preserve the original semantic intent')
    expect(JSON.stringify(feedback)).not.toContain('PRIVATE_SOURCE_BODY')
  })

  it('returns every missing candidate category path and the shared category enum while preserving first intent', () => {
    const error = new z.ZodError(Array.from({ length: 8 }, (_, index) => ({
      code: 'custom', path: ['candidates', index, 'category'], message: 'PRIVATE_CANDIDATE_VALUE'
    })))
    const feedback = safeCommitFeedback(error, 'arguments', { acceptedGoal: false })
    expect(feedback.fields).toEqual(Array.from({ length: 8 }, (_, index) => `candidates.${index}.category`))
    expect(feedback.allowedCategories).toEqual(['event', 'seasonal', 'activity', 'stopover', 'practical'])
    expect(feedback.correction).toContain('Classify candidates from their evidence')
    expect(feedback.instruction).toContain('preserve the original semantic intent')
    expect(JSON.stringify(feedback)).not.toContain('PRIVATE_CANDIDATE_VALUE')
  })
  it('asks for the first objective once and keeps later corrections on the immutable accepted Goal', () => {
    const missing = safeCommitFeedback(new AppError('GOAL_INTENT_REQUIRED', 'untrusted', 409), 'arguments')
    expect(missing.instruction).toContain('Include the original intent')
    const conflict = safeCommitFeedback(new AppError('GOAL_INTENT_CONFLICT', 'untrusted', 409), 'arguments')
    expect(conflict.instruction).toContain('omit intent/goalRef')
    expect(conflict.instruction).toContain('immutable')
    expect(conflict.instruction).not.toContain('Repeat exactly')
    const correction = safeCommitFeedback(new z.ZodError([]), 'arguments')
    expect(correction.instruction).toContain('omit intent/goalRef')
    const firstSubmission = safeCommitFeedback(new z.ZodError([]), 'arguments', { acceptedGoal: false })
    expect(firstSubmission.instruction).toContain('preserve the original semantic intent')
    expect(firstSubmission.instruction).not.toContain('omit intent/goalRef')
    const acceptedCorrection = safeCommitFeedback(new z.ZodError([]), 'arguments', { acceptedGoal: true })
    expect(acceptedCorrection.instruction).toContain('The Goal is accepted; omit intent/goalRef')
    expect(acceptedCorrection.instruction).not.toContain('preserve the original semantic intent')
  })

  it('keeps argument and prerequisites outside the one content repair quota', () => {
    const recovery = new CommitRecovery()
    recovery.admit(); recovery.failed(new z.ZodError([{ code: 'invalid_type', expected: 'string', path: ['intent'] }]))
    recovery.admit(); recovery.failed(new AppError('DSH_GUIDE_NEEDS_REVISION', 'untrusted', 422,
      { code: 'candidate_location_unresolved', candidateKey: 'place' }))
    recovery.admit(); recovery.failed(new AppError('DSH_GUIDE_NEEDS_REVISION', 'duplicate', 422,
      { issues: ['guide_duplicate_evidence'] }))
    recovery.admit(); recovery.accepted()
    expect(recovery.snapshot()).toMatchObject({ calls: 4, argumentCorrections: 1, contentAttempts: 2 })
    expect(() => recovery.admit()).toThrowError(/content repair/)
  })

  it('bounds repeated argument and prerequisite calls globally', () => {
    const argumentsOnly = new CommitRecovery()
    for (let i = 0; i < 3; i++) { argumentsOnly.admit(); argumentsOnly.failed(new z.ZodError([])) }
    expect(() => argumentsOnly.admit()).toThrowError(/argument correction/)
    const prerequisites = new CommitRecovery()
    for (let i = 0; i < 6; i++) {
      prerequisites.admit()
      prerequisites.failed(new AppError('DSH_GUIDE_NEEDS_REVISION', 'missing', 422, { code: 'candidate_key_unavailable' }))
    }
    expect(() => prerequisites.admit()).toThrowError(/submission limit/)
  })

  it('never forwards arbitrary app details, messages or provider bodies to the model', () => {
    const secret = 'PRIVATE_PROVIDER_BODY'
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', secret, 422, {
      code: 'candidate_evidence_unavailable', repairHint: secret, providerBody: secret,
      candidates: [{ candidateKey: 'temple', unavailableEvidenceRefs: ['ref-1'], injected: secret }],
      issues: ['guide_duplicate_evidence'], weird: secret,
    })
    const feedback = safeCommitFeedback(error, 'prerequisite')
    expect(feedback).toMatchObject({ code: 'DSH_GUIDE_NEEDS_REVISION', kind: 'prerequisite',
      revisionCode: 'candidate_evidence_unavailable', candidates: [{ candidateKey: 'temple', unavailableEvidenceRefs: ['ref-1'] }] })
    expect(JSON.stringify(feedback)).not.toContain(secret)
  })

  it('returns bounded candidate, day and protected-slot corrections from server-owned fields', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'untrusted narrative', 422, {
      issues: ['guide_duplicate_evidence'], replaceSlots: [{ day: 2, slot: 'afternoon' }],
      details: [{ code: 'guide_duplicate_evidence', day: 2, fieldPath: 'days[1].items[0]', location: 'city:TYO' }],
      repair: { issues: [{ code: 'guide_duplicate_evidence', classification: 'draft_invalid', day: 2 }],
        availableCandidates: [{ candidateRef: 'gc1.example', title: 'Museum', category: 'activity', cityIds: ['city:TYO'],
          providerBody: 'PRIVATE_PROVIDER_BODY' }], candidateSearchComplete: false },
    })
    const feedback = safeCommitFeedback(error, 'content')
    expect(feedback).toMatchObject({ protectedSlots: [{ day: 2, slot: 'afternoon' }],
      locations: [{ day: 2, fieldPath: 'days[1].items[0]', location: 'city:TYO' }],
      repair: { availableCandidates: [{ candidateRef: 'gc1.example', title: 'Museum', cityIds: ['city:TYO'] }] } })
    expect(JSON.stringify(feedback)).not.toContain('PRIVATE_PROVIDER_BODY')
  })

  it('keeps the one repair instruction consistent with the narrow budget target allowance', () => {
    const feedback = safeCommitFeedback(new AppError('DSH_GUIDE_NEEDS_REVISION', 'untrusted', 422,
      { presentationIssues: ['excluded_precise_claim'] }), 'content')
    expect(feedback.correction).toContain('exact current trip budget amount only as a total-trip target')
    expect(feedback.correction).toContain('do not claim that costs fit it')
    expect(feedback.correction).not.toContain('Remove monetary amounts')
  })

  it('exposes only validated day-coverage fields and keeps presentation corrections', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_PROVIDER_BODY', 422, {
      issues: ['guide_day_coverage', 'guide_duplicate_evidence'], presentationIssues: ['excluded_precise_claim'],
      dayCoverage: { expectedDays: 2, submittedDays: [1, 2, 3], travelWindow: { from: '2026-11-03', to: '2026-11-04' }, injected: 'PRIVATE' },
      repairHint: 'PRIVATE_PROVIDER_BODY'
    })
    const feedback = safeCommitFeedback(error, 'content', { acceptedGoal: true })
    expect(feedback.dayCoverage).toEqual({ expectedDays: 2, submittedDays: [1, 2, 3],
      travelWindow: { from: '2026-11-03', to: '2026-11-04' } })
    expect(feedback.correction).toContain('exactly 2 sequential day(s)')
    expect(feedback.correction).toContain('exact current trip budget amount only as a total-trip target')
    expect(feedback.correction).toContain('Use a distinct candidate/finding for each scheduled visit')
    expect(JSON.stringify(feedback)).not.toContain('PRIVATE_PROVIDER_BODY')
    expect(JSON.stringify(feedback)).not.toContain('injected')
  })

  it('drops malformed or out-of-range day-coverage values', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'untrusted', 422, {
      dayCoverage: { expectedDays: 61, submittedDays: [1, '2'], travelWindow: { from: 'not-a-date' } }
    })
    const feedback = safeCommitFeedback(error, 'content', { acceptedGoal: true })
    expect(feedback).not.toHaveProperty('dayCoverage')
  })
})
