import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { GuideFinalizer, sourceRef } from './finalization.js'
import { finalTextSchema, type FinalText } from './finalization-schema.js'
import { travelGuideArtifactPayloadSchema } from './artifact.js'
import { admittedResearch, buildGuidePublication, publicationFor, projectGuideRecord } from './publication.js'
import { finalizeGuide } from './finalization-service.js'
import { InMemoryArtifactRepository, type ArtifactRecord } from '../artifacts/repository.js'

const sample = JSON.parse(readFileSync(new URL('../../test/fixtures/g1-publication-v1-original-samples.json', import.meta.url), 'utf8')).cases[0].legacy
function fixture(locale: 'zh' | 'en' = 'zh') {
  const record = structuredClone(sample.artifact) as ArtifactRecord
  const guide = travelGuideArtifactPayloadSchema.parse(record.payload)
  const research = admittedResearch(sample.researchArtifacts)
  const text: FinalText = { locale,
    reply: locale === 'zh' ? '已整理好东京文化漫游安排，按每天的主题查看景点。' : 'Your Tokyo cultural itinerary is ready. Explore the visits by daily theme.',
    overview: locale === 'zh' ? '围绕传统文化安排游览，保留轻松节奏，感受东京不同街区的氛围。' : 'Explore traditional culture at a relaxed pace across the planned Tokyo neighborhoods.',
    days: guide.days.map(day => ({ day: day.day, theme: locale === 'zh' ? '街区文化漫游' : 'Neighborhood culture' })),
    activities: guide.days.flatMap(day => day.items).map(item => ({ activityId: item.id,
      name: locale === 'zh' ? '浅草寺 Senso-ji' : 'Senso-ji Temple',
      introduction: locale === 'zh' ? '在寺院周边漫步，欣赏寺院建筑，感受传统街区的氛围。' : 'Walk around the temple, appreciate its architecture and explore the traditional neighborhood.',
      recommendationReason: locale === 'zh' ? '这段安排呼应文化兴趣，也为悠闲游览留出空间。' : 'This visit responds to your interest in culture while allowing a relaxed pace.', sourceRefs: [sourceRef(item)] })) }
  guide.publication = { ...buildGuidePublication(record, guide, research), finalization: { version: 1, variants: {} } }
  record.payload = guide
  return { record, guide, research, text, input: { locale, guide, research, requirements: { message: '我想了解传统文化', excluded: ['shopping'] } } }
}
const response = (text: FinalText) => ({ message: { role: 'assistant' as const, content: JSON.stringify({ text, issues: [] }) } })

describe('bounded finalization', () => {
  it.each(['zh', 'en'] as const)('generates %s from full evidence once using the same client/model with no tools', async locale => {
    const f = fixture(locale)
    const complete = vi.fn(async (messages, model, options) => {
      expect(model).toBe('current-planner-model')
      expect(options.tools).toEqual([]); expect(options.toolChoice).toBe('none')
      expect(options.responseFormat.type).toBe('json_schema')
      const data = JSON.parse(messages[1].content)
      expect(data.requirements.message).toContain('传统文化')
      expect(data.research.length).toBe(f.research.length)
      expect(data.guide.publication).toBeUndefined()
      return response(f.text)
    })
    const result = await new GuideFinalizer({ complete }, 'current-planner-model').generate(f.input)
    expect(result.status).toBe('accepted'); expect(result.observation.calls).toBe(1)
    expect(result.text?.activities[0]?.name).toContain('Senso-ji')
  })
  it.each(['invalid_json', 'internal', 'budget', 'duplicate', 'wrong_locale', 'identity', 'source', 'precise', 'placeholder'])('repairs %s at most once', async failure => {
    const f = fixture()
    const bad = structuredClone(f.text)
    if (failure === 'internal') bad.reply = 'I will now summarize the itinerary.'
    if (failure === 'budget') bad.reply = '保证所有花费都在预算内。'
    if (failure === 'duplicate') bad.reply += ' Here is a complete English translation of the itinerary that repeats all the same details for every day.'
    if (failure === 'wrong_locale') bad.locale = 'en'
    if (failure === 'identity') bad.activities[0]!.activityId = 'replacement'
    if (failure === 'source') bad.activities[0]!.sourceRefs = ['invented']
    if (failure === 'precise') bad.reply = '门票需要200元，步行15分钟到达。'
    if (failure === 'placeholder') bad.activities.forEach(item => { item.name = '待核实'; item.introduction = '资料不足。' })
    const complete = vi.fn().mockResolvedValueOnce(failure === 'invalid_json' ? { message: { role: 'assistant', content: 'oops' } } : response(bad)).mockResolvedValueOnce(response(f.text))
    expect((await new GuideFinalizer({ complete }).generate(f.input)).status).toBe('accepted')
    expect(complete).toHaveBeenCalledTimes(2)
  })
  it('keeps a concrete activity issue without retries for semantic insufficiency', async () => {
    const f = fixture()
    const complete = vi.fn().mockResolvedValue({ message: { role: 'assistant', content: JSON.stringify({ text: null,
      issues: [{ activityId: f.text.activities[0]!.activityId, code: 'conflict', detail: 'The source reports closure on the planned date.' }] }) } })
    const result = await new GuideFinalizer({ complete }).generate(f.input)
    expect(result.status).toBe('blocked'); expect(result.issues[0]?.activityId).toBe(f.text.activities[0]!.activityId)
    expect(complete).toHaveBeenCalledTimes(1)
  })
  it('does not call for missing sources, transport as a visit or oversized material', async () => {
    const f = fixture(), complete = vi.fn()
    const finalizer = new GuideFinalizer({ complete })
    expect((await finalizer.generate({ ...f.input, research: [] })).issues[0]?.code).toBe('missing_material')
    const item = f.guide.days[0]!.items[0]!
    f.research.find(r => r.id === item.sourceArtifactId)!.findings.find(v => v.id === item.sourceFindingId)!.category = 'practical'
    expect((await finalizer.generate(f.input)).issues[0]?.code).toBe('invalid_plan')
    const other = fixture()
    expect((await finalizer.generate({ ...other.input, requirements: 'x'.repeat(180001) })).issues[0]?.code).toBe('context_budget')
    expect(complete).not.toHaveBeenCalled()
  })
  it('bounds timeout, cancellation and irreparable JSON without exposing raw output', async () => {
    const f = fixture()
    const never = { complete: vi.fn(() => new Promise<any>(() => {})) }
    expect((await new GuideFinalizer(never).generate({ ...f.input, timeoutMs: 5 })).issues[0]?.code).toBe('timeout')
    const controller = new AbortController(); controller.abort()
    expect((await new GuideFinalizer(never).generate({ ...f.input, signal: controller.signal })).issues[0]?.code).toBe('cancelled')
    const complete = vi.fn().mockResolvedValue({ message: { role: 'assistant', content: 'RAW SECRET DRAFT' } })
    const result = await new GuideFinalizer({ complete }).generate(f.input)
    expect(complete).toHaveBeenCalledTimes(2); expect(result.text).toBeNull()
    expect(JSON.stringify(result)).not.toContain('RAW SECRET')
  })
  it('merges concurrent requests, persists variants and restores without calling; localization shares IDs', async () => {
    const f = fixture()
    const artifacts = new InMemoryArtifactRepository('owner', new Set([f.record.tripId]))
    for (const record of sample.researchArtifacts as ArtifactRecord[]) await artifacts.create({ ...record })
    // Fixture sources include route lineage not needed by this repository-only test.
    const record = await artifacts.create({ ...f.record, goalId: undefined, runId: undefined, sourceArtifactIds: [] })
    const complete = vi.fn().mockResolvedValue(response(f.text))
    const input = { ownerId: 'owner', record, artifacts, locale: 'zh' as const, memoryEnabled: true,
      finalizer: new GuideFinalizer({ complete }), assertCurrent: async () => {} }
    const [a, b] = await Promise.all([finalizeGuide(input), finalizeGuide(input)])
    expect(a).toEqual(b); expect(complete).toHaveBeenCalledTimes(1)
    await finalizeGuide({ ...input, record: (await artifacts.get(record.id))! })
    expect(complete).toHaveBeenCalledTimes(1)
    expect((projectGuideRecord(a, 'en').payload as any).publication.status).toBe('preparing')
    const en = fixture('en').text
    complete.mockImplementation(async messages => { const data = JSON.parse(messages[1].content); expect(data.accepted).toEqual(f.text); expect(data.research).toBeUndefined(); return response(en) })
    const localized = await finalizeGuide({ ...input, record: a, locale: 'en', localization: true })
    expect(publicationFor(localized)?.finalization?.variants.zh?.text).toEqual(f.text)
    expect((projectGuideRecord(localized, 'en').payload as any).days[0].items[0].title).toBe('Senso-ji Temple')
    expect((projectGuideRecord(localized, 'zh').payload as any).days[0].items[0].title).toBe('浅草寺 Senso-ji')
    expect((projectGuideRecord(record).payload as any).days).toEqual([])
    expect((localized.payload as any).days).toEqual(f.guide.days)
    expect(finalTextSchema.parse(en).activities.map(a => a.activityId)).toEqual(f.text.activities.map(a => a.activityId))
  })
  it('rejects stale/foreign content and keeps raw drafts private', async () => {
    const f = fixture(), complete = vi.fn()
    const artifacts = new InMemoryArtifactRepository('other', new Set([f.record.tripId]))
    await expect(finalizeGuide({ ownerId: 'other', record: f.record, artifacts, finalizer: new GuideFinalizer({ complete }),
      locale: 'zh', assertCurrent: async () => { throw new Error('version changed') } })).rejects.toThrow('version changed')
    expect(complete).not.toHaveBeenCalled()
    expect(JSON.stringify(projectGuideRecord(f.record))).not.toContain('planningNote')
    delete f.guide.publication!.finalization
    const legacyEnglish = projectGuideRecord(f.record, 'en').payload as any
    expect(legacyEnglish.days).toEqual([])
    expect(legacyEnglish.publication.reply).toContain('not ready')
  })
})
