import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { loadBackend } from './baseline.mjs';
import { createThinResearchAgent } from './thin-research.mjs';

let backend, schemas, policy;
before(async () => {
  backend = await loadBackend();
  const types = await backend.import('research-agent/types.ts');
  const aviation = await backend.import('aviation/types.ts');
  policy = await backend.import('research-agent/verification.ts');
  schemas = { researchBriefSchema: types.researchBriefSchema, researchArtifactSchema: types.researchArtifactSchema,
    researchSourceSchema: types.researchSourceSchema, verificationRecordSchema: aviation.verificationRecordSchema };
});
after(async () => backend?.close());

const brief = { destinations: [
  { id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP' },
  { id: 'city:OSA', type: 'city', name: 'Osaka', countryCode: 'JP' },
], interests: ['culture'], questions: ['Find cultural activities.'], researchTypes: ['activity'], maxResults: 2 };
const finding = { destinationIndex: 0, category: 'activity', title: 'Museum', summary: 'Visit the museum; booking status is unknown.', sourceUrls: ['https://www.gotokyo.org/en/spot/museum'] };
const annotation = { type: 'url_citation', url_citation: { url: finding.sourceUrls[0], title: 'Museum visitor information', content: 'A museum open to visitors. Booking details require confirmation.' } };
const data = overrides => ({ disposition: 'recommend', findings: [structuredClone(finding)], uncertainties: [], ...overrides });
const receipt = overrides => ({ message: { role: 'assistant', content: JSON.stringify(data()), annotations: [structuredClone(annotation)] }, finishReason: 'stop',
  usage: { server_tool_use: { web_search_requests: 1 } }, ...overrides });

function fixture(options = {}) {
  const audits = [], requests = [];
  const agent = createThinResearchAgent({ ...schemas, model: 'qwen/qwen3.8-flash', now: () => new Date('2026-09-13T00:00:00.000Z'),
    complete: async request => { requests.push(request); return receipt(); }, saveAudit: async audit => { audits.push(audit); }, ...options });
  return { agent, audits, requests };
}

test('returns a genuine v2 artifact with one configurable request and a separately persisted audit', async () => {
  const { agent, audits, requests } = fixture();
  const input = structuredClone(brief);
  const artifact = await agent.research(input, { requestId: 'success', preferenceSummary: ['Avoid unnecessary stairs.'] });
  assert.equal(schemas.researchArtifactSchema.safeParse(artifact).success, true);
  assert.deepEqual(input, brief);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.model, 'qwen/qwen3.8-flash');
  assert.equal(requests[0].body.provider.allow_fallbacks, true);
  assert.equal(Object.hasOwn(requests[0].body, 'models'), false);
  assert.equal(requests[0].body.max_tool_calls, 2);
  assert.equal(requests[0].body.tools[0].parameters.max_characters, 800);
  assert.deepEqual(JSON.parse(requests[0].body.messages[1].content).preferenceSummary, ['Avoid unnecessary stairs.']);
  assert.equal(artifact.queryCount, 1);
  assert.equal(artifact.findings[0].sources[0].authority, 'unknown');
  assert.equal(artifact.findings[0].verification.status, 'unverified');
  assert.equal(audits.length, 1);
  assert.equal(audits[0].artifactId, artifact.id);
  assert.equal(audits[0].raw.content, receipt().message.content);
  assert.equal(audits[0].normalization.raw.valid, true);
  assert.ok(artifact.warnings.includes(`thin_research_audit:${audits[0].id}`));
});

test('uses injected frozen domain authority/verification without trusting model authority or ever producing verified', async () => {
  const output = data({ findings: [{ ...finding, authority: 'official_event', verification: 'verified' }] });
  const { agent, audits } = fixture({ ...policy, model: 'z-ai/glm-5.3-flash', modelOptions: { reasoning: { enabled: true, effort: 'low', exclude: true } },
    complete: async ({ body }) => {
      assert.equal(body.model, 'z-ai/glm-5.3-flash');
      assert.equal(body.reasoning.effort, 'low');
      return receipt({ message: { ...receipt().message, content: JSON.stringify(output) } });
    } });
  const artifact = await agent.research(brief, { requestId: 'domain-policy' });
  assert.equal(artifact.findings[0].sources[0].authority, policy.classifyResearchSourceAuthority(finding.sourceUrls[0]));
  assert.deepEqual(artifact.findings[0].verification, policy.verifyResearchFinding('activity', artifact.findings[0].sources, { checkedAt: artifact.createdAt }));
  assert.equal(artifact.findings[0].verification.status, 'partially_verified');
  assert.equal(audits[0].normalization.raw.valid, false);
  assert.equal(audits[0].normalization.normalized.valid, true);
  assert.ok(artifact.warnings.includes('thin_research_structure_normalized'));
  const forbidden = fixture({ verifyResearchFinding: (_category, sources, { checkedAt }) => ({ status: 'verified', confidence: 1, checkedAt, sources: [] }) });
  await assert.rejects(forbidden.agent.research(brief, { requestId: 'bad-policy' }), { code: 'THIN_RESEARCH_VERIFICATION_POLICY_INVALID' });
});

test('source metadata excerpts are explicit and retain complete annotations and truncation paths in the audit', async () => {
  const full = { ...annotation.url_citation, title: 'T'.repeat(241), content: 'A'.repeat(800) + ' Qualification beyond the retained excerpt.' };
  const { agent, audits } = fixture({ complete: async () => receipt({ message: { ...receipt().message,
    annotations: [{ type: 'url_citation', url_citation: full }] } }) });
  const artifact = await agent.research(brief, { requestId: 'excerpt' });
  assert.equal(artifact.findings[0].sources[0].title.length, 240);
  assert.equal(artifact.findings[0].sources[0].snippet.length, 800);
  assert.ok(artifact.warnings.includes('source_excerpt_truncated'));
  assert.ok(artifact.findings[0].warnings.includes('source_excerpt_truncated'));
  assert.deepEqual(audits[0].raw.annotations[0].url_citation, full);
  assert.deepEqual(audits[0].sourceExcerpts.map(item => item.path), ['/message/annotations/0/url_citation/title', '/message/annotations/0/url_citation/content']);
  assert.equal(artifact.findings[0].summary, finding.summary);
});

test('unlinked, empty-snippet and overlong-URL sources exclude the whole affected finding, preserving other candidates as partial', async () => {
  for (const bad of [
    { url: 'https://missing.example/venue' },
    { url: 'https://empty.example/venue', citation: { title: 'Venue', content: '' } },
    { url: `https://long.example/${'x'.repeat(500)}`, citation: { title: 'Venue', content: 'Real snippet' } },
  ]) {
    const rejected = { ...finding, title: 'Unusable', sourceUrls: [finding.sourceUrls[0], bad.url] };
    const annotations = [structuredClone(annotation), ...(bad.citation ? [{ type: 'url_citation', url_citation: { url: bad.url, ...bad.citation } }] : [])];
    const { agent, audits } = fixture({ complete: async () => receipt({ message: { role: 'assistant', content: JSON.stringify(data({ findings: [finding, rejected] })), annotations } }) });
    const artifact = await agent.research(brief, { requestId: 'missing-source' });
    assert.equal(artifact.findings.length, 1);
    assert.equal(artifact.findings[0].title, finding.title);
    assert.ok(artifact.warnings.includes('thin_research_disposition:partial'));
    assert.equal(audits[0].rejectedFindings[0].index, 1);
    assert.deepEqual(audits[0].rejectedFindings[0].urls, [bad.url]);
  }
});

test('clarification and partial responses keep all uncertainties independently with explicit long-text audit references', async () => {
  const uncertainties = ['Which arrival date is correct?', 'Q'.repeat(1000)];
  for (const disposition of ['clarify', 'partial']) {
    const { agent, audits } = fixture({ complete: async () => receipt({ message: { ...receipt().message,
      content: JSON.stringify(data({ disposition, findings: [], uncertainties })), annotations: [] }, usage: { server_tool_use_details: { web_search_requests: 0 } } }) });
    const artifact = await agent.research(brief, { requestId: disposition });
    assert.deepEqual(artifact.findings, []);
    assert.ok(artifact.warnings.includes(`thin_research_disposition:${disposition}`));
    assert.ok(artifact.warnings.includes(uncertainties[0]));
    assert.ok(artifact.warnings.includes('thin_research_uncertainty_in_audit:1:exceeds_240_chars'));
    assert.deepEqual(audits[0].uncertainties, uncertainties);
    assert.equal(audits[0].disposition, disposition);
    assert.equal(artifact.queryCount, 0);
  }
});

test('maps only the indexed supplied destination and does not invent cross-city coverage', async () => {
  const { agent } = fixture({ complete: async () => receipt({ message: { ...receipt().message,
    content: JSON.stringify(data({ findings: [{ ...finding, destinationIndex: 1 }] })) } }) });
  const artifact = await agent.research(brief, { requestId: 'second-city' });
  assert.deepEqual(artifact.findings[0].destinations, [brief.destinations[1]]);
  assert.ok(artifact.findings[0].warnings.includes('research_evidence_is_snippet_only'));
});

test('invalid structure, excessive findings and invalid indexes/categories are rejected without repair requests', async () => {
  const { summary, ...missingSummary } = finding;
  for (const output of [
    data({ findings: [{ ...finding, destinationIndex: 2 }] }),
    data({ findings: [{ ...finding, category: 'event' }] }),
    data({ findings: [finding, { ...finding, title: 'Second' }, { ...finding, title: 'Third' }] }),
    data({ findings: [{ ...missingSummary, description: summary }] }),
    data({ findings: [{ ...finding, summary: 'x'.repeat(1501) }] }),
  ]) {
    let calls = 0;
    const { agent, audits } = fixture({ complete: async () => { calls++; return receipt({ message: { ...receipt().message, content: JSON.stringify(output) } }); } });
    await assert.rejects(agent.research(brief, { requestId: 'invalid-output' }), { code: 'THIN_RESEARCH_OUTPUT_INVALID' });
    assert.equal(calls, 1);
    assert.equal(audits[0].status, 'failed');
    assert.equal(audits[0].raw.content, JSON.stringify(output));
  }
});

test('requires a known consistent search count and preserves incomplete/model-error outcomes', async () => {
  for (const [value, code] of [
    [receipt({ usage: undefined }), 'THIN_RESEARCH_SEARCH_COUNT_UNKNOWN'],
    [receipt({ searchCalls: 2 }), 'THIN_RESEARCH_SEARCH_COUNT_CONFLICT'],
    [receipt({ searchCalls: 25, usage: undefined }), 'THIN_RESEARCH_SEARCH_COUNT_INVALID'],
    [receipt({ finishReason: 'length' }), 'THIN_RESEARCH_MODEL_INCOMPLETE'],
    [receipt({ finishReason: undefined }), 'THIN_RESEARCH_MODEL_INCOMPLETE'],
  ]) {
    const { agent, audits } = fixture({ complete: async () => value });
    await assert.rejects(agent.research(brief, { requestId: code }), { code });
    assert.equal(audits[0].modelCalls, 1);
  }
  let calls = 0;
  const failed = fixture({ complete: async () => { calls++; const error = new Error('Never log a transport credential here'); error.code = 'PROVIDER_UNAVAILABLE'; throw error; } });
  await assert.rejects(failed.agent.research(brief, { requestId: 'model-error' }), { code: 'THIN_RESEARCH_MODEL_FAILED' });
  assert.equal(calls, 1);
  assert.equal(failed.audits[0].modelError.code, 'PROVIDER_UNAVAILABLE');
  assert.equal(JSON.stringify(failed.audits).includes('credential here'), false);
  const unknown = fixture({ complete: async () => receipt({ usage: undefined,
    message: { ...receipt().message, content: JSON.stringify(data({ disposition: 'partial', uncertainties: ['Confirm access before visiting.'] })) } }) });
  await assert.rejects(unknown.agent.research(brief, { requestId: 'unknown-cost-metadata' }), { code: 'THIN_RESEARCH_SEARCH_COUNT_UNKNOWN' });
  assert.equal(unknown.audits[0].disposition, 'partial');
  assert.deepEqual(unknown.audits[0].uncertainties, ['Confirm access before visiting.']);
});

test('pre-cancellation prevents dispatch and a late completion cannot return an artifact after cancellation', async () => {
  const before = fixture();
  await assert.rejects(before.agent.research(brief, { requestId: 'pre-cancel', signal: AbortSignal.abort() }), { code: 'RESEARCH_CANCELLED' });
  assert.equal(before.requests.length, 0);
  assert.equal(before.audits[0].status, 'cancelled');
  const controller = new AbortController();
  const afterCompletion = fixture({ complete: async () => { controller.abort(); return receipt(); } });
  await assert.rejects(afterCompletion.agent.research(brief, { requestId: 'post-cancel', signal: controller.signal }), { code: 'RESEARCH_CANCELLED' });
  assert.equal(afterCompletion.audits[0].modelCalls, 1);
  assert.equal(afterCompletion.audits[0].raw.content, receipt().message.content);
  assert.equal(afterCompletion.audits[0].status, 'cancelled');
});

test('audit persistence is required, and persistence failure never returns an artifact', async () => {
  assert.throws(() => createThinResearchAgent({ ...schemas, model: 'model', complete: async () => receipt() }), /saveAudit/);
  let attempts = 0;
  const { agent } = fixture({ saveAudit: async () => { attempts++; throw new Error('disk failure'); } });
  await assert.rejects(agent.research(brief, { requestId: 'save-fails' }), error => {
    assert.equal(error.code, 'THIN_RESEARCH_AUDIT_SAVE_FAILED');
    assert.equal(error.audit.raw.content, receipt().message.content);
    return true;
  });
  assert.equal(attempts, 1);
});

test('cancellation during an exclusive audit save rejects delivery without a second write or replacing the cancellation error', async () => {
  const controller = new AbortController();
  const stored = new Map();
  let attempts = 0;
  const { agent } = fixture({ saveAudit: async audit => {
    attempts++;
    if (stored.has(audit.id)) throw new Error('EEXIST: audit IDs are exclusive');
    stored.set(audit.id, structuredClone(audit));
    controller.abort();
    await Promise.resolve();
  } });
  await assert.rejects(agent.research(brief, { requestId: 'cancel-during-save', signal: controller.signal }), error => {
    assert.equal(error.code, 'RESEARCH_CANCELLED');
    assert.ok(stored.has(error.auditId));
    const saved = stored.get(error.auditId);
    assert.equal(saved.status, 'recommend', 'The immutable audit records generation, not successful delivery');
    assert.equal(saved.raw.content, receipt().message.content);
    assert.ok(saved.artifactId);
    assert.equal(saved.error, undefined);
    return true;
  });
  assert.equal(attempts, 1);
  assert.equal(stored.size, 1);
});

test('deadline is cooperative: it signals the transport and rejects late receipts without claiming an independent hard stop', async () => {
  let resolveTransport, transportSignal, settled = false;
  const { agent, audits } = fixture({ modelOptions: { timeoutMs: 10 },
    complete: ({ signal }) => {
      transportSignal = signal;
      return new Promise(resolve => { resolveTransport = resolve; });
    } });
  const run = agent.research(brief, { requestId: 'uncooperative-transport' });
  const outcome = run.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(transportSignal.aborted, true);
  assert.equal(settled, false, 'The injected transport must settle before accounting and audit can finish');
  resolveTransport(receipt());
  const { error } = await outcome;
  assert.equal(error.code, 'THIN_RESEARCH_TIMEOUT');
  assert.equal(audits[0].status, 'timeout');
  assert.equal(audits[0].raw.content, receipt().message.content);
});
