import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ArtifactRecord } from '../artifacts/repository.js'
import { projectGuideRecord, buildGuidePublication } from './publication.js'
import { travelGuideArtifactPayloadSchema } from './artifact.js'

const fixture = JSON.parse(readFileSync(new URL('../../test/fixtures/g1-publication-v1-original-samples.json', import.meta.url), 'utf8')) as { cases: any[] }

describe('G1 publication v1 fixture P5 boundary', () => {
  it.each(fixture.cases)('keeps $id day schedule and practical references explicit', sample => {
    const legacy = sample.legacy.artifact as ArtifactRecord
    const research = sample.legacy.researchArtifacts as ArtifactRecord[]
    const current = { ...legacy, id: `current-${legacy.id}` } as ArtifactRecord
    const parsed = travelGuideArtifactPayloadSchema.parse(legacy.payload)
    const payload = { ...parsed, publication: buildGuidePublication(current, parsed, research.map(value => ({ ...value.payload, id: value.id } as any))) }
    current.payload = payload
    const projected = projectGuideRecord(current)
    const days = (projected.payload as any).days
    expect(days).toHaveLength(2)
    expect(days.every((day: any) => typeof day.day === 'number' && typeof day.city?.name === 'string')).toBe(true)
    expect(days.flatMap((day: any) => day.items).every((item: any) => typeof item.timeOfDay === 'string')).toBe(true)
    const text = JSON.stringify(days)
    expect(text).toContain('建议时段仅表示安排意向')
    expect(text).toContain('费用、开放时间、预约要求和交通耗时待核实')
    expect((projected.payload as any).publication.budgetAssessment.knownSubtotal).toBeNull()
    expect((projected.payload as any).publication.legacy).toBe(false)
    expect(days.map((day: any) => day.items.map((item: any) => item.timeOfDay)))
      .toEqual((legacy.payload as any).days.map((day: any) => day.items.map((item: any) => item.timeOfDay)))
    const visibleDay = (index: number) => days[index].items.map((item: any) => `${item.title}\n${item.description}`).join('\n')
    const practical = (projected.payload as any).supportingEvidence.map((item: any) => item.description).join('\n')
    if (sample.id === 'selfTicket') {
      expect(visibleDay(0)).toMatch(/Senso[- ]ji Temple/i)
      expect(visibleDay(1)).toMatch(/Meiji Jingu/i)
      expect(visibleDay(0)).toMatch(/ramen.*takoyaki/i)
      expect(practical).toContain('To ride the subway, buses and waterbuses, use an IC card')
    } else {
      expect(visibleDay(0)).toContain('浅草寺')
      expect(visibleDay(1)).toContain('上野')
      expect(visibleDay(1)).toContain('可丽饼')
      expect(practical).toContain('可以从成田机场直接到达东京站')
    }
  })

  it.each(fixture.cases)('marks the original legacy record as limited P5 evidence', sample => {
    const projected = projectGuideRecord(sample.legacy.artifact as ArtifactRecord)
    expect((projected.payload as any).warnings).toContain('legacy_guide_publication_limited')
    expect(JSON.stringify(projected.payload)).not.toContain('planningNote')
    expect(JSON.stringify(projected.payload)).toContain('待核实')
  })
})
