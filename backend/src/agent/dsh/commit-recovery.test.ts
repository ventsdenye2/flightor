import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import { CommitRecovery, safeCommitFeedback } from './commit-recovery.js'

describe('DSH commit recovery policy', () => {
  it('asks for the first objective once and keeps later corrections on the immutable accepted Goal', () => {
    const missing = safeCommitFeedback(new AppError('GOAL_INTENT_REQUIRED', 'untrusted', 409), 'arguments')
    expect(missing.instruction).toContain('new semantic intent')
    const conflict = safeCommitFeedback(new AppError('GOAL_INTENT_CONFLICT', 'untrusted', 409), 'arguments')
    expect(conflict.instruction).toContain('omit intent/goalRef')
    expect(conflict.instruction).toContain('immutable')
    expect(conflict.instruction).not.toContain('Repeat exactly')
    const correction = safeCommitFeedback(new z.ZodError([]), 'arguments')
    expect(correction.instruction).toContain('omit intent/goalRef')
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
})
