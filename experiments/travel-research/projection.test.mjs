import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCurrentArtifact, reviewProjection } from './projection.mjs';

const fukuoka = { type: 'city', id: 'city:FUK', name: '福冈', countryCode: 'JP' };
const beppu = { type: 'city', id: 'city:BEPPU', name: '别府', countryCode: 'JP' };
const testCase = { id: 'two-cities', request: '研究两城活动', brief: { destinations: [fukuoka, beppu] } };

function finding(destination, overrides = {}) {
  return {
    title: `${destination.name}文化活动`,
    summary: '日期和营业时间仍需核实。',
    category: 'activity',
    destinations: [destination],
    sources: [{ title: '场馆资料', url: 'https://example.org/venue', domain: 'example.org',
      snippet: '常设文化展；此片段未提供2026年开放日期。', authority: 'official_venue' }],
    verification: { status: 'unverified', checkedAt: '2026-09-13T00:00:00Z', confidence: 0.2 },
    warnings: ['evidence_unverified', '未公布旅行日期的营业安排'],
    ...overrides
  };
}

function artifact(findings = [finding(fukuoka), finding(beppu)]) {
  return { findings, warnings: ['仅有搜索片段，尚未核验全文'] };
}

test('current artifact retains unverified evidence, two-city ownership and contextual warnings', () => {
  const raw = artifact();
  const before = structuredClone(raw);
  const result = normalizeCurrentArtifact(raw, testCase);
  assert.equal(result.valid, true);
  assert.equal(result.disposition, null);
  assert.deepEqual(result.findings.map(item => item.destinationIndex), [0, 1]);
  assert.deepEqual(result.findings.map(item => item.destinations), [[fukuoka], [beppu]]);
  for (let i = 0; i < raw.findings.length; i++) {
    const item = result.findings[i];
    assert.equal(item.verification, 'unverified');
    assert.equal(item.citationLinked, true);
    assert.deepEqual(item.sourceUrls, ['https://example.org/venue']);
    assert.deepEqual(item.sources, raw.findings[i].sources);
    assert.deepEqual(item.warnings, raw.findings[i].warnings);
    assert.ok(result.uncertainties.includes(`候选「${item.title}」：evidence_unverified`));
    assert.ok(result.uncertainties.includes(`候选「${item.title}」：未公布旅行日期的营业安排`));
  }
  assert.equal(result.uncertainties[0], raw.warnings[0]);
  result.findings[0].destinations[0].name = 'edited';
  result.findings[0].sources[0].snippet = 'edited';
  assert.deepEqual(raw, before, 'projection must not mutate the raw evidence');
});

test('a finding spanning both cities keeps all destinations and uses the first matching ID as its scalar index', () => {
  const result = normalizeCurrentArtifact(artifact([
    finding(beppu, { destinations: [beppu, fukuoka] })
  ]), testCase);
  assert.equal(result.findings[0].destinationIndex, 1);
  assert.deepEqual(result.findings[0].destinations, [beppu, fukuoka]);
});

test('unmatched destination IDs do not silently acquire the first city', () => {
  const unknown = { ...fukuoka, id: 'city:UNKNOWN' };
  const result = normalizeCurrentArtifact(artifact([finding(unknown)]), testCase);
  assert.equal(result.findings[0].destinationIndex, null);
  assert.deepEqual(result.findings[0].destinations, [unknown]);
});

test('neither populated nor empty artifacts invent a conversational disposition', () => {
  for (const findings of [[], [finding(fukuoka)]]) {
    const result = normalizeCurrentArtifact(artifact(findings), testCase);
    assert.equal(result.disposition, null);
    assert.equal(result.findings.length, findings.length);
  }
});

test('review uses current raw artifact in preference to an earlier lossy result snapshot', () => {
  const raw = artifact();
  const row = { id: 'sample-006', model: 'hidden/model', arm: 'current-system', trace: [{ secret: 'hidden' }],
    currentSystem: { artifact: raw }, status: 'responded',
    result: { disposition: 'recommend', findings: [{ title: 'stale projection', verification: 'verified' }], uncertainties: [] } };
  const review = reviewProjection(row, testCase);
  assert.deepEqual(Object.keys(review).sort(), ['case', 'citations', 'content', 'findings', 'sampleId', 'status', 'uncertainties']);
  assert.equal(review.sampleId, row.id);
  assert.equal(review.status, 'responded', 'execution status is retained, not interpreted as a recommendation');
  assert.equal(review.findings[0].title, raw.findings[0].title);
  assert.equal(review.findings[0].verification, 'unverified');
  assert.deepEqual(review.findings[1].destinations, [beppu]);
  assert.equal(review.uncertainties.length, 5);
  assert.equal(review.content, null);
  assert.equal(review.citations, null);
  assert.ok(!JSON.stringify(review).includes('hidden/model'));
  assert.ok(!Object.hasOwn(review, 'disposition'));
});

test('thin structured review retains unverified, unlinked URLs and evidence limitations without execution metadata', () => {
  const item = { destinationIndex: 1, title: '待确认活动', summary: '开放时间待核实。', category: 'activity',
    sourceUrls: ['https://example.org/unlinked'], citationLinked: false,
    unlinkedUrls: ['https://example.org/unlinked'], verification: 'unverified',
    warnings: ['没有来源正文'], sources: [{ url: 'https://example.org/unlinked', snippet: '仅摘要' }],
    model: 'hidden/model', arm: 'thin-web', trace: [{ secret: 'hidden' }] };
  const row = { id: 'sample-007', model: 'hidden/model', arm: 'thin-web', trace: [{ secret: 'hidden' }],
    content: '原始回答', status: 'unlinked_evidence', citations: [],
    result: { disposition: 'partial', findings: [item], uncertainties: ['价格未知'] } };
  const before = structuredClone(row);
  const review = reviewProjection(row, testCase);
  assert.equal(review.findings[0].verification, 'unverified');
  assert.equal(review.findings[0].citationLinked, false);
  assert.deepEqual(review.findings[0].unlinkedUrls, item.unlinkedUrls);
  assert.deepEqual(review.findings[0].warnings, item.warnings);
  assert.deepEqual(review.findings[0].sources, item.sources);
  assert.deepEqual(review.uncertainties, ['价格未知']);
  assert.equal(review.content, '原始回答');
  assert.equal(review.status, 'unlinked_evidence');
  assert.ok(!JSON.stringify(review).includes('hidden/model'));
  for (const key of ['model', 'arm', 'trace']) assert.ok(!Object.hasOwn(review.findings[0], key));
  assert.deepEqual(row, before);
});

test('direct text and failed responses remain text or failures without fabricated findings', () => {
  const direct = reviewProjection({ id: 'sample-003', content: '候选及其证据不足说明',
    result: null, citations: [{ url: 'https://example.org', title: '资料' }], status: 'responded' }, testCase);
  assert.equal(direct.content, '候选及其证据不足说明');
  assert.equal(direct.findings, null);
  assert.deepEqual(direct.uncertainties, []);
  assert.equal(direct.citations[0].url, 'https://example.org');
  const failure = reviewProjection({ id: 'sample-009', status: 'error',
    currentSystem: { artifact: null, raw: { trace: ['hidden'] } } }, testCase);
  assert.equal(failure.status, 'error');
  assert.equal(failure.findings, null);
  assert.equal(failure.content, null);
  assert.deepEqual(failure.uncertainties, []);
});
