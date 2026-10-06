import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../../lib/errors.js'
import { CommitRecovery, classifyCommitFailure, safeCommitFeedback } from './commit-recovery.js'
import { dshCommitInputSchema } from './preparation.js'

describe('DSH commit recovery policy', () => {
  it('reports the complete initial finding count as a bounded argument correction without consuming content repair', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_BODY', 422, {
      code: 'guide_initial_result_limit', selectedFindingCount: 10, maxResults: 8,
      maxAllowedResults: 999, fieldPath: 'PRIVATE_FIELD', providerBody: 'PRIVATE_BODY'
    })
    const recovery = new CommitRecovery()
    recovery.admit()
    const kind = recovery.failed(error)
    expect(kind).toBe('arguments')
    expect(recovery.snapshot()).toMatchObject({ calls: 1, argumentCorrections: 1, contentAttempts: 0 })
    const feedback = safeCommitFeedback(error, kind, { acceptedGoal: false })
    expect(feedback).toMatchObject({ revisionCode: 'guide_initial_result_limit', selectedFindingCount: 10, maxResults: 8,
      maxAllowedResults: 20, fields: ['intent.parameters.maxResults'] })
    expect(feedback.correction).toContain('No Goal has been accepted')
    expect(feedback.correction).toContain('distinct scheduled and supporting findings')
    expect(feedback.correction).toContain('user request')
    expect(feedback.correction).toContain('Do not silently drop')
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_|999/)
  })
  it.each([
    [-1, 8], [461, 8], [1.5, 8], ['PRIVATE_COUNT', 8], [10, 0], [10, 21], [10, 'PRIVATE_LIMIT']
  ])('filters malformed or out-of-bound initial counts %s/%s', (selectedFindingCount, maxResults) => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_BODY', 422,
      { code: 'guide_initial_result_limit', selectedFindingCount, maxResults })
    const feedback = safeCommitFeedback(error, 'arguments', { acceptedGoal: false })
    if (!Number.isInteger(selectedFindingCount) || Number(selectedFindingCount) < 0 || Number(selectedFindingCount) > 460)
      expect(feedback).not.toHaveProperty('selectedFindingCount')
    if (!Number.isInteger(maxResults) || Number(maxResults) < 1 || Number(maxResults) > 20)
      expect(feedback).not.toHaveProperty('maxResults')
    expect(feedback.maxAllowedResults).toBe(20)
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_/)
  })
  it('does not reclassify a persisted Goal result-limit failure or encourage changing its accepted cap', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_BODY', 422, { issues: ['guide_result_limit'] })
    expect(classifyCommitFailure(error)).toBe('content')
    const feedback = safeCommitFeedback(error, 'content', { acceptedGoal: true })
    expect(feedback.instruction).toContain('preserving the accepted Goal')
    expect(feedback).not.toHaveProperty('maxAllowedResults')
    expect(feedback).not.toHaveProperty('selectedFindingCount')
  })
  it.each([
    ['candidate_temporal_evidence_missing', 'missing', 'prerequisite'],
    ['candidate_temporal_evidence_invalid', 'source_not_selected', 'prerequisite'],
    ['candidate_temporal_evidence_invalid', 'unavailable', 'prerequisite'],
    ['candidate_temporal_evidence_invalid', 'quote_not_found', 'content'],
    ['candidate_temporal_evidence_invalid', 'date_mismatch', 'content'],
    ['candidate_temporal_evidence_invalid', 'PRIVATE_REASON', 'content']
  ] as const)('keeps event proof %s/%s in its existing bounded %s allowance', (code, reason, kind) => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_BODY', 422, {
      code, reason, candidateIndex: 4, fieldPath: 'candidates.4.temporalEvidence', quote: 'PRIVATE_QUOTE', url: 'https://private.example'
    })
    expect(classifyCommitFailure(error)).toBe(kind)
    const feedback = safeCommitFeedback(error, kind, { acceptedGoal: true })
    expect(feedback).toMatchObject({ fields: ['candidates.4.temporalEvidence'], candidateIndex: 4 })
    expect(feedback.correction).toContain('exact occurrence-date quote')
    expect(feedback.correction).toContain('Do not relabel an event')
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_|private\.example/)
    const recovery = new CommitRecovery()
    recovery.admit(); recovery.failed(error)
    expect(recovery.contentAttempts).toBe(kind === 'content' ? 1 : 0)
  })
  it('does not echo a forged event-proof field or out-of-range candidate index', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_BODY', 422, {
      code: 'candidate_temporal_evidence_invalid', reason: 'date_mismatch', candidateIndex: 50,
      fieldPath: 'PRIVATE_PATH', quote: 'PRIVATE_QUOTE'
    })
    const feedback = safeCommitFeedback(error, 'content')
    expect(feedback).not.toHaveProperty('fields')
    expect(feedback).not.toHaveProperty('candidateIndex')
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_/)
  })
  it('identifies the repeated day from the r18 optional-event submission without choosing or dropping an activity', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_BODY', 422, {
      code: 'duplicate_day_or_activity_key', days: [1, 2, 2], activityKeys: ['a', 'b', 'c'],
      providerBody: 'PRIVATE_BODY'
    })
    const kind = classifyCommitFailure(error)
    const recovery = new CommitRecovery()
    recovery.admit(); recovery.failed(error)
    const feedback = safeCommitFeedback(error, kind, { acceptedGoal: true })
    expect(kind).toBe('prerequisite')
    expect(feedback).toMatchObject({ submittedDayNumbers: [1, 2, 2], duplicateDayNumbers: [2], fields: ['days.2.day'] })
    expect(feedback.correction).toContain('one entry per day number')
    expect(feedback.correction).toContain('do not invent a rest day')
    expect(feedback.correction).toContain('Do not silently drop user-required activities')
    expect(recovery.snapshot()).toMatchObject({ calls: 1, argumentCorrections: 0, contentAttempts: 0 })
    expect(JSON.stringify(feedback)).not.toContain('PRIVATE_BODY')
  })
  it('bounds duplicate-day diagnostics and ignores malformed or private day values', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_BODY', 422, {
      code: 'duplicate_day_or_activity_key', days: [1, 'PRIVATE_DAY', 2, 2, 0, 61, 1.5, ...Array(80).fill(3)]
    })
    const feedback = safeCommitFeedback(error, 'prerequisite')
    expect(feedback.submittedDayNumbers).toEqual([1, 2, 2, ...Array(53).fill(3)])
    expect(feedback.duplicateDayNumbers).toEqual([2, 3])
    expect((feedback.fields as string[])[0]).toBe('days.3.day')
    expect((feedback.fields as string[]).every(field => /^days\.(?:[0-9]|[1-5][0-9])\.day$/.test(field))).toBe(true)
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_BODY|PRIVATE_DAY/)
  })
  it('exposes only controlled publication reasons and compact input paths', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_PROVIDER_BODY', 422, {
      issues: [{ code: 'format', detail: 'PRIVATE_TEXT', activityId: null }],
      presentationProblems: [
        { code: 'excluded_precise_claim', fieldPath: 'text.overview', value: 'PRIVATE_TEXT' },
        { code: 'budget_guarantee', fieldPath: 'days.1.items.2.text.recommendationReason' },
        { code: 'excluded_precise_claim', fieldPath: 'text.overview' },
        { code: 'PRIVATE_CODE', fieldPath: 'text.reply' },
        { code: 'excluded_precise_claim', fieldPath: 'days.60.items.0.text.name' },
        { code: 'excluded_precise_claim', fieldPath: 'days.01.items.0.text.name' },
        { code: 'excluded_precise_claim', fieldPath: 'days.0.items.6.text.name' },
        { code: 'excluded_precise_claim', fieldPath: 'text.activities.0.name' },
        { code: 'excluded_precise_claim', fieldPath: 'PRIVATE_FIELD' }
      ]
    })
    const feedback = safeCommitFeedback(error, 'content')
    expect(feedback.presentationProblems).toEqual([
      { code: 'excluded_precise_claim', fieldPath: 'text.overview' },
      { code: 'budget_guarantee', fieldPath: 'days.1.items.2.text.recommendationReason' }
    ])
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_|text.activities|days.60|days.01|items.6/)
  })
  it('reports the r12 raw-source verification mismatch as a prerequisite without consuming a content attempt', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_RAW_SOURCE', 422,
      { code: 'raw_evidence_requires_partial', fieldPath: 'intent.parameters.allowPartial', providerBody: 'PRIVATE_RAW_SOURCE' })
    const kind = classifyCommitFailure(error)
    expect(kind).toBe('prerequisite')
    const feedback = safeCommitFeedback(error, kind, { acceptedGoal: false })
    expect(feedback).toMatchObject({ revisionCode: 'raw_evidence_requires_partial', fields: ['intent.parameters.allowPartial'] })
    expect(feedback.correction).toContain('No Goal has been accepted')
    expect(feedback.correction).toContain('only if this matches the user request')
    expect(feedback.correction).toContain('independently verified')
    expect(JSON.stringify(feedback)).not.toContain('PRIVATE_RAW_SOURCE')
    const recovery = new CommitRecovery()
    recovery.admit(); recovery.failed(error)
    expect(recovery.snapshot()).toMatchObject({ calls: 1, contentAttempts: 0, argumentCorrections: 0 })
  })

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
  it('keeps missing Trip city feedback bounded and outside content/argument quotas', () => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_PROVIDER_BODY', 422, {
      code: 'candidate_location_unresolved', destinationMode: 'open', selectedCityCount: 0,
      fieldPaths: ['candidates.0.locationId', 'days.1.cityId', 'private.injected.path'], providerBody: 'PRIVATE_PROVIDER_BODY' })
    const kind = classifyCommitFailure(error)
    const feedback = safeCommitFeedback(error, kind)
    expect(kind).toBe('prerequisite')
    expect(feedback).toMatchObject({ revisionCode: 'candidate_location_unresolved', destinationMode: 'open',
      selectedCityCount: 0, fields: ['candidates.0.locationId', 'days.1.cityId'] })
    expect(feedback.correction).toContain('select a matching canonical city already confirmed in the current Trip')
    expect(feedback.correction).toContain('do not collapse an existing multi-city Trip to one city')
    expect(feedback.correction).toContain('new version')
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_PROVIDER_BODY|private\.injected|locationId.*raw/)
    const recovery = new CommitRecovery()
    recovery.admit(); recovery.failed(error)
    expect(recovery.snapshot()).toMatchObject({ calls: 1, argumentCorrections: 0, contentAttempts: 0, lastFailure: 'prerequisite' })
  })
  it('retains all 110 schema-bounded location paths after filtering invalid entries', () => {
    const validPaths = [
      ...Array.from({ length: 50 }, (_, index) => `candidates.${index}.locationId`),
      ...Array.from({ length: 60 }, (_, index) => `days.${index}.cityId`)
    ]
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_PROVIDER_BODY', 422, {
      code: 'candidate_location_unresolved',
      fieldPaths: ['private.injected.path', 'candidates.00.locationId', 'candidates.50.locationId',
        'days.60.cityId', 'days.0.cityId\n', validPaths[0], ...validPaths]
    })
    const feedback = safeCommitFeedback(error, classifyCommitFailure(error))
    expect(feedback.fields).toEqual(validPaths)
    expect(JSON.stringify(feedback)).not.toContain('private.injected.path')
  })
  it.each([
    [{ registrationStatus: 'not_submitted', missingCandidateKeys: ['nakamise'], availableCandidateKeys: [] }, 'No candidates are registered'],
    [{ registrationStatus: 'not_submitted', missingCandidateKeys: ['new-key'], availableCandidateKeys: ['temple'] }, 'Only availableCandidateKeys are registered'],
    [{ registrationStatus: 'submitted_incomplete', missingCandidateKeys: ['garden'], availableCandidateKeys: ['temple'] }, 'submitted candidate list replaces']
  ] as const)('returns bounded registration guidance for missing candidate keys', (details, correction) => {
    const error = new AppError('DSH_GUIDE_NEEDS_REVISION', 'PRIVATE_PROVIDER_BODY', 422,
      { code: 'candidate_key_unavailable', fieldPath: 'candidates', ...details, providerBody: 'PRIVATE_PROVIDER_BODY' })
    const kind = classifyCommitFailure(error)
    expect(kind).toBe('prerequisite')
    const feedback = safeCommitFeedback(error, kind, { acceptedGoal: true })
    expect(feedback).toMatchObject({ revisionCode: 'candidate_key_unavailable', fieldPath: 'candidates',
      registrationStatus: details.registrationStatus, missingCandidateKeys: details.missingCandidateKeys,
      availableCandidateKeys: details.availableCandidateKeys })
    expect(feedback.correction).toContain(correction)
    expect(feedback.correction).toContain('current-turn sourceRefs')
    expect(JSON.stringify(feedback)).not.toContain('PRIVATE_PROVIDER_BODY')
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

  it('explains unknown keys at the compact text path without echoing unknown names or values', () => {
    const textSchema = dshCommitInputSchema.shape.text
    const unknownIssue = (schema: z.ZodTypeAny, value: unknown, path: (string | number)[]) => {
      const parsed = schema.safeParse(value)
      if (parsed.success) throw new Error('Expected the compact text schema to reject unknown keys')
      const issue = parsed.error.issues.find(issue => issue.code === 'unrecognized_keys')
      if (!issue) throw new Error('Expected a Zod unrecognized_keys issue')
      return { ...issue, path: [...path, ...issue.path] }
    }
    const error = new z.ZodError([
      unknownIssue(textSchema, {
      reply: 'A short guide reply.', overview: 'A short guide overview.',
      days: [{ day: 1, theme: 'Culture' }],
      days2: 'PRIVATE_DAYS2_VALUE', activities: 'PRIVATE_DOMAIN_VALUE', PRIVATE_AUTH_TOKEN: 'PRIVATE_UNKNOWN_VALUE'
      }, ['text']),
      unknownIssue(textSchema.shape.days.element, { day: 1, theme: 'Culture', PRIVATE_DAY_FIELD: 'PRIVATE_DAY_VALUE' }, ['text', 'days', 0]),
      unknownIssue(dshCommitInputSchema.shape.days.element.shape.items.element.shape.text,
        { name: 'Temple', introduction: 'Visit the temple.', recommendationReason: 'It fits the request.',
          activityId: 'PRIVATE_ACTIVITY_ID', PRIVATE_ITEM_TEXT: 'PRIVATE_ITEM_TEXT_VALUE' }, ['days', 0, 'items', 0, 'text'])
    ])
    const recovery = new CommitRecovery()
    recovery.admit()
    const kind = recovery.failed(error)
    const feedback = safeCommitFeedback(error, kind, { acceptedGoal: true })

    expect(kind).toBe('arguments')
    expect(feedback).toMatchObject({
      fields: ['text', 'text.days.0', 'days.0.items.0.text'],
      allowedFields: [
        { fieldPath: 'text', fields: ['reply', 'overview', 'days'] },
        { fieldPath: 'text.days.0', fields: ['day', 'theme'] },
        { fieldPath: 'days.0.items.0.text', fields: ['name', 'introduction', 'recommendationReason'] }
      ]
    })
    expect(feedback.correction).toContain('allowed fields')
    expect(recovery.snapshot()).toMatchObject({ calls: 1, argumentCorrections: 1, contentAttempts: 0 })
    expect(JSON.stringify(feedback)).not.toMatch(/days2|activities|sourceRefs|activityId|PRIVATE_AUTH_TOKEN|PRIVATE_DAYS2_VALUE|PRIVATE_DOMAIN_VALUE|PRIVATE_UNKNOWN_VALUE|PRIVATE_DAY_FIELD|PRIVATE_DAY_VALUE|PRIVATE_ITEM_TEXT|PRIVATE_ACTIVITY_ID/)
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
