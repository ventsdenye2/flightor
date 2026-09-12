import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResearch } from './contracts.mjs';
import { normalizeResearchResponse } from './normalization.mjs';

const testCase = { brief: { destinations: [{}], researchTypes: ['activity'], maxResults: 2 } };
const finding = { destinationIndex: 0, category: 'activity', title: 'Museum', summary: 'Visit the museum.', sourceUrls: ['https://example.org/visit'] };
const citations = [{ url: finding.sourceUrls[0] }];
const response = overrides => ({ disposition: 'recommend', findings: [structuredClone(finding)], uncertainties: [], ...overrides });
const json = overrides => JSON.stringify(response(overrides));
const fenced = value => `\`\`\`json\n${value}\n\`\`\``;
const normalize = content => normalizeResearchResponse(content, testCase, citations);

test('valid direct JSON remains unchanged with original strict validity and timing', () => {
  const content = json();
  const result = normalize(content);
  assert.deepEqual(result.raw, parseResearch(content, testCase, citations));
  assert.deepEqual(result.normalized, result.raw);
  assert.deepEqual(result.transforms, []);
  assert.ok(Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0);
  assert.equal(result.normalized.findings[0].verification, 'unverified');
});

test('Kimi-like extra type fields are projected with every dropped path recorded', () => {
  const content = json({ type: 'research', findings: [{ ...finding, type: 'recommendation', confidence: 1 }], 'extra/key~': { data: 'discarded subtree' } });
  const result = normalize(content);
  assert.equal(result.raw.valid, false);
  assert.equal(result.normalized.valid, true);
  assert.deepEqual(result.transforms, [{ type: 'drop_unknown_fields', paths: ['/type', '/extra~1key~0', '/findings/0/type', '/findings/0/confidence'] }]);
  assert.deepEqual(result.normalized, parseResearch(json(), testCase, citations));
});

test('Deep-like English prose plus one final JSON fence is extracted without model-specific handling', () => {
  const content = `I will verify sources and provide the final activity candidates.\n\n${fenced(json())}\n`;
  const result = normalize(content);
  assert.equal(result.raw.valid, false);
  assert.equal(result.normalized.valid, true);
  assert.deepEqual(result.transforms, [{ type: 'extract_final_fenced_json' }]);
  assert.deepEqual(result.normalized, parseResearch(json(), testCase, citations));
});

test('Qwen-like prose and a single bare JSON suffix preserve raw failure and record extraction', () => {
  for (const prefix of ['I will verify the available sources.\n\n', '资料已整理，候选如下：']) {
    const content = `${prefix}${json()}\n\t`;
    const result = normalize(content);
    assert.deepEqual(result.raw, parseResearch(content, testCase, citations));
    assert.equal(result.raw.valid, false);
    assert.equal(result.normalized.valid, true);
    assert.deepEqual(result.transforms, [{ type: 'extract_single_json_suffix' }]);
    assert.deepEqual(result.normalized, parseResearch(json(), testCase, citations));
  }
});

test('bare suffix extraction composes with projection and cannot supply missing fields', () => {
  const result = normalize(`Research complete.\n${json({ type: 'result', findings: [{ ...finding, type: 'activity' }] })}`);
  assert.equal(result.raw.valid, false);
  assert.equal(result.normalized.valid, true);
  assert.deepEqual(result.transforms, [
    { type: 'extract_single_json_suffix' },
    { type: 'drop_unknown_fields', paths: ['/type', '/findings/0/type'] },
  ]);
  const { summary, ...withoutSummary } = finding;
  const invalid = normalize(`Research complete.\n${json({ findings: [{ ...withoutSummary, description: summary }] })}`);
  assert.equal(invalid.normalized.valid, false);
  assert.deepEqual(invalid.transforms, [
    { type: 'extract_single_json_suffix' },
    { type: 'drop_unknown_fields', paths: ['/findings/0/description'] },
  ]);
});

test('bare suffix extraction rejects delimiters or backticks in prose and never selects a later JSON', () => {
  const value = json();
  const prefixes = ['Research } completed. ', 'Research [completed] ', 'Research ] completed. ', 'Research `completed` ', 'First {invalid}. '];
  const contents = [
    ...prefixes.map(prefix => `${prefix}${value}`),
    `Research complete. ${value}\n${value}`,
    `Research complete. ${value}\n[]`,
    `Research complete. ${value}\nTrailing text.`,
    `Research complete. [{"candidate":true}]\n${value}`,
    `Research complete. {invalid}\n${value}`,
    `${value}\n${value}`,
  ];
  for (const content of contents) {
    const result = normalize(content);
    assert.equal(result.raw.valid, false);
    assert.equal(result.normalized.valid, false);
    assert.deepEqual(result.transforms, []);
  }
});

test('extraction and field projection compose in a recorded order', () => {
  const result = normalize(`Research complete.\n${fenced(json({ type: 'result', findings: [{ ...finding, type: 'activity' }] }))}`);
  assert.equal(result.raw.valid, false);
  assert.equal(result.normalized.valid, true);
  assert.deepEqual(result.transforms, [
    { type: 'extract_final_fenced_json' },
    { type: 'drop_unknown_fields', paths: ['/type', '/findings/0/type'] },
  ]);
});

test('preserves the existing parser acceptance of a bare fence in the raw result', () => {
  const content = fenced(json());
  const result = normalize(content);
  assert.deepEqual(result.raw, parseResearch(content, testCase, citations));
  assert.equal(result.raw.valid, true);
  assert.deepEqual(result.transforms, []);
});

test('missing known fields and description in place of summary cannot be repaired', () => {
  const { summary, ...withoutSummary } = finding;
  const { uncertainties, ...withoutUncertainties } = response();
  for (const content of [
    JSON.stringify(withoutUncertainties),
    json({ findings: [withoutSummary] }),
    json({ findings: [{ ...withoutSummary, description: summary }] }),
    `Final answer follows.\n${fenced(json({ findings: [{ ...withoutSummary, description: summary }] }))}`,
  ]) {
    const result = normalize(content);
    assert.equal(result.raw.valid, false);
    assert.equal(result.normalized.valid, false);
  }
  assert.deepEqual(normalize(json({ findings: [{ ...withoutSummary, description: summary }] })).transforms,
    [{ type: 'drop_unknown_fields', paths: ['/findings/0/description'] }]);
});

test('does not truncate counts, coerce indexes, change categories, repair unsafe URLs or alter dates', () => {
  const invalid = [
    json({ type: 'result', findings: [finding, { ...finding, title: 'Second' }, { ...finding, title: 'Third' }] }),
    json({ findings: [{ ...finding, destinationIndex: '0', type: 'activity' }] }),
    json({ findings: [{ ...finding, destinationIndex: 1, type: 'activity' }] }),
    json({ findings: [{ ...finding, category: 'practical', type: 'activity' }] }),
    json({ findings: [{ ...finding, sourceUrls: ['javascript:alert(1)'], type: 'activity' }] }),
  ];
  for (const content of invalid) assert.equal(normalize(content).normalized.valid, false);
  const unverified = { ...finding, summary: 'An event on 1999-01-01; this text must stay exactly as written.', sourceUrls: ['https://unlinked.example/old-event'] };
  const result = normalize(json({ findings: [{ ...unverified, type: 'activity' }] }));
  assert.equal(result.normalized.valid, true);
  assert.equal(result.normalized.findings[0].summary, unverified.summary);
  assert.deepEqual(result.normalized.findings[0].sourceUrls, unverified.sourceUrls);
  assert.equal(result.normalized.findings[0].citationLinked, false);
  assert.deepEqual(result.normalized.findings[0].unlinkedUrls, unverified.sourceUrls);
  assert.equal(result.normalized.findings[0].verification, 'unverified');
});

test('rejects multiple fences, trailing prose or JSON, and ambiguous earlier JSON', () => {
  const value = json();
  for (const content of [
    `${fenced(value)}\n${fenced(value)}`,
    `Research complete.\n${fenced(value)}\nAdditional commentary.`,
    `Research complete.\n${fenced(value)}\n${value}`,
    `${value}\n${fenced(value)}`,
    `Earlier object: ${value}\n${fenced(value)}`,
    `Prose before ${value} and after.`,
    `Research complete.\n\`\`\`javascript\n${value}\n\`\`\``,
  ]) {
    const result = normalize(content);
    assert.equal(result.raw.valid, false);
    assert.equal(result.normalized.valid, false);
    assert.deepEqual(result.transforms, []);
  }
});

test('invalid JSON and nonobject findings are not repaired', () => {
  for (const content of ['{"findings":', fenced('{invalid}'), json({ type: 'result', findings: [null] }), JSON.stringify([response()])]) {
    const result = normalize(content);
    assert.equal(result.normalized.valid, false);
  }
});
