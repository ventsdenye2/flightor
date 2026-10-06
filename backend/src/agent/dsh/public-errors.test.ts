import { describe, expect, it } from 'vitest'
import { classifyDshFailure, publicFailureReply } from './public-errors.js'

describe('public DSH failure classification', () => {
  it('classifies publication labels without interpreting repair instructions or provider prose as codes', () => {
    expect(classifyDshFailure('DSH_GUIDE_NEEDS_REVISION', {
      issues: [{ code: 'format', detail: 'excluded_precise_claim' }],
      repairHint: 'Reuse the existing source and evidence bindings.', providerBody: 'LOCATION SOURCE PRIVATE BODY'
    })).toBe('publication')
    expect(classifyDshFailure('DSH_TOOL_FAILURE', { providerBody: 'LOCATION SOURCE PRIVATE BODY' })).toBeUndefined()
  })
  it.each([
    ['PROVIDER_TIMEOUT', null, 'provider'],
    ['MODEL_OUTPUT_LIMIT', null, 'output_limit'],
    ['DSH_GUIDE_NEEDS_REVISION', { code: 'candidate_location_unresolved' }, 'location'],
    ['DSH_GUIDE_NEEDS_REVISION', { issues: [{ code: 'missing_material' }] }, 'evidence'],
    ['DSH_GUIDE_NEEDS_REVISION', { code: 'candidate_key_unavailable', candidateKey: 'private-candidate' }, 'evidence'],
    ['DSH_GUIDE_NEEDS_REVISION', { issues: [{ code: 'conflict' }] }, 'publication'],
    ['TRIP_CONTEXT_VERSION_CONFLICT', null, 'context_conflict'],
    ['PUBLICATION_CONTENT_CHANGED', null, 'context_conflict'],
    ['DSH_GUIDE_BASE_UNAVAILABLE', null, 'context_conflict'],
    ['DSH_CANDIDATE_REFERENCE_UNAVAILABLE', null, 'evidence'],
    ['RATE_LIMIT', null, 'provider'],
    ['DSH_COMMIT_CALL_LIMIT', null, 'commit'],
    ['CONVERSATION_TURN_NOT_FOUND', null, 'ui_restore']
  ] as const)('classifies %s with details %j', (code, details, expected) => {
    expect(classifyDshFailure(code, details)).toBe(expected)
  })

  it('returns bounded localized public copy without accepting a provider body', () => {
    expect(publicFailureReply('provider', 'en')).toContain('Check the saved results')
    expect(publicFailureReply('publication', 'zh')).toContain('草稿没有作为正式结果显示')
    expect(publicFailureReply('context_conflict', 'en')).toContain('did not replace the current content')
    expect(publicFailureReply('provider', 'en')).not.toMatch(/stack|api.?key|provider body/i)
  })

  it('uses precise safe copy for an unavailable candidate key prerequisite', () => {
    const details = { code: 'candidate_key_unavailable', candidateKey: 'private-candidate' }
    const stage = classifyDshFailure('DSH_GUIDE_NEEDS_REVISION', details)!
    const zh = publicFailureReply(stage, 'zh', details.code)
    const en = publicFailureReply(stage, 'en', details.code)
    expect(zh).toContain('行程活动与参考资料未能正确关联')
    expect(zh).toContain('先查看行程中已保存的结果')
    expect(en).toContain('trip activity could not be correctly linked')
    expect(en).toContain('Check the saved results in your trip')
    expect(`${zh} ${en}`).not.toMatch(/candidate_key_unavailable|private-candidate|DSH_GUIDE_NEEDS_REVISION/i)
  })
  it.each(['candidate_temporal_evidence_missing', 'candidate_temporal_evidence_invalid', 'guide_event_date_evidence_missing'])(
    'explains the occurrence-date evidence gap for %s without asking for unrelated preferences', cause => {
      const stage = classifyDshFailure('DSH_GUIDE_NEEDS_REVISION', { code: cause })!
      expect(stage).toBe('evidence')
      const zh = publicFailureReply(stage, 'zh', cause)
      const en = publicFailureReply(stage, 'en', cause)
      expect(zh).toContain('活动日期')
      expect(zh).toContain('本轮未发布新的攻略')
      expect(en).toContain('event dates')
      expect(en).toContain('No new guide was published')
      expect(`${zh} ${en}`).not.toMatch(/temporalEvidence|sourceRef|candidate_|guide_event_|地点或偏好|place or preference/)
      expect(publicFailureReply('provider', 'en', cause)).toBe(publicFailureReply('provider', 'en'))
    })
  it('uses fixed public copy when a guide has no confirmed Trip destination', () => {
    const details = { code: 'candidate_location_unresolved', fieldPaths: ['candidates.0.locationId'], selectedCityCount: 0 }
    const stage = classifyDshFailure('DSH_GUIDE_NEEDS_REVISION', details)!
    const zh = publicFailureReply(stage, 'zh', details.code)
    const en = publicFailureReply(stage, 'en', details.code)
    expect(stage).toBe('location')
    expect(zh).toContain('地点尚未与当前行程确认关联')
    expect(zh).toContain('核对并确认行程目的地')
    expect(en).toContain('not yet confirmed against the current trip')
    expect(en).toContain('Check and confirm the trip destination')
    expect(`${zh} ${en}`).not.toMatch(/candidate_location_unresolved|candidates\.0|locationId|selectedCityCount/i)
  })

  it('ignores unknown cause codes and keeps the stage fallback copy', () => {
    expect(publicFailureReply('evidence', 'zh', 'private_unknown_cause'))
      .toBe(publicFailureReply('evidence', 'zh'))
    expect(publicFailureReply('evidence', 'en', 'private_unknown_cause'))
      .toBe(publicFailureReply('evidence', 'en'))
  })

  it('explains an unavailable local-edit base without claiming the trip changed', () => {
    const zh = publicFailureReply('context_conflict', 'zh', 'DSH_GUIDE_BASE_UNAVAILABLE')
    const en = publicFailureReply('context_conflict', 'en', 'DSH_GUIDE_BASE_UNAVAILABLE')
    expect(zh).toContain('当前没有可用于局部修改的已发布攻略')
    expect(zh).toContain('完成当前显示语言的准备')
    expect(en).toContain('There is no published guide available for a local edit')
    expect(en).toContain('in the displayed language')
    expect(`${zh} ${en}`).not.toMatch(/DSH_GUIDE_BASE_UNAVAILABLE|stack|token=|provider body/i)
  })

  it('leaves unknown failures unclassified instead of exposing their text', () => {
    expect(classifyDshFailure('SECRET_PROVIDER_BODY: token=abc')).toBeUndefined()
  })
})
