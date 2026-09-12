import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { citationSources, researchMessages, schemaForCase, safeUrl } from '../travel-research/contracts.mjs';
import { normalizeResearchResponse } from '../travel-research/normalization.mjs';

export class ThinResearchError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ThinResearchError';
    this.code = code;
    this.statusCode = 502;
    if (details !== undefined) this.details = details;
  }
}

const fail = (code, message, details) => { throw new ThinResearchError(code, message, details); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function errorIdentity(error) {
  const safe = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value) ? value : undefined;
  const status = error?.statusCode ?? error?.status;
  return { name: safe(error?.name) ?? 'Error', ...(safe(error?.code) ? { code: error.code } : {}),
    ...(Number.isInteger(status) ? { statusCode: status } : {}) };
}

function abortIfNeeded(signal, callerSignal) {
  if (signal?.aborted) fail(callerSignal?.aborted ? 'RESEARCH_CANCELLED' : 'THIN_RESEARCH_TIMEOUT',
    callerSignal?.aborted ? 'Research was cancelled' : 'Research exceeded its deadline');
}

function checkedContext(context) {
  if (!context || typeof context.requestId !== 'string' || !context.requestId.trim() || context.requestId.length > 160) {
    fail('INVALID_RESEARCH_CONTEXT', 'Research requestId is invalid');
  }
  const preferences = context.preferenceSummary;
  if (preferences !== undefined && (!Array.isArray(preferences) || preferences.length > 32 || preferences.some(value =>
    typeof value !== 'string' || !value.trim() || value.length > 160))) {
    fail('INVALID_RESEARCH_CONTEXT', 'Research preference summary is invalid');
  }
  return preferences === undefined ? [] : structuredClone(preferences);
}

function countedSearches(receipt) {
  const values = [receipt.searchCalls, receipt.usage?.server_tool_use?.web_search_requests,
    receipt.usage?.server_tool_use_details?.web_search_requests].filter(value => value !== undefined && value !== null);
  if (values.length === 0) fail('THIN_RESEARCH_SEARCH_COUNT_UNKNOWN', 'The transport did not report a search count');
  if (values.some(value => !Number.isInteger(value) || value < 0 || value > 24)) {
    fail('THIN_RESEARCH_SEARCH_COUNT_INVALID', 'The transport search count is outside the artifact contract');
  }
  if (values.some(value => value !== values[0])) fail('THIN_RESEARCH_SEARCH_COUNT_CONFLICT', 'The transport reported conflicting search counts');
  return values[0];
}

function sourceExcerpt(text, limit, path, audit) {
  if (text.length <= limit) return text;
  let excerpt = text.slice(0, limit);
  // Avoid retaining only the high surrogate of a Unicode character.
  if (/[\uD800-\uDBFF]$/.test(excerpt)) excerpt = excerpt.slice(0, -1);
  audit.sourceExcerpts.push({ type: 'source_excerpt_truncated', path, originalLength: text.length, retainedLength: excerpt.length });
  return excerpt;
}

function admittedSources(annotations, schemas, classify, audit) {
  const byUrl = new Map();
  annotations.forEach((annotation, index) => {
    if (annotation?.type !== 'url_citation') return;
    const citation = annotation.url_citation;
    const url = typeof citation?.url === 'string' ? safeUrl(citation.url) : null;
    const path = `/message/annotations/${index}/url_citation`;
    if (!url) { audit.sourceIssues.push({ path, code: 'invalid_source_url' }); return; }
    if (typeof citation.title !== 'string' || !citation.title.trim() || typeof citation.content !== 'string' || !citation.content.trim()) {
      audit.sourceIssues.push({ path, url, code: 'source_metadata_missing' }); return;
    }
    const excerptCount = audit.sourceExcerpts.length;
    const candidate = {
      title: sourceExcerpt(citation.title, 240, `${path}/title`, audit),
      url,
      domain: new URL(url).hostname,
      snippet: sourceExcerpt(citation.content, 800, `${path}/content`, audit),
      authority: classify ? classify(url) : 'unknown',
    };
    const parsed = schemas.researchSourceSchema.safeParse(candidate);
    if (!parsed.success) {
      audit.sourceIssues.push({ path, url, code: 'source_domain_schema_invalid',
        issues: parsed.error.issues.map(issue => ({ code: issue.code, path: issue.path })) });
      return;
    }
    if (!byUrl.has(url)) byUrl.set(url, []);
    // Distinct annotations for the same URL may contain different limitations;
    // retain them all rather than silently selecting a preferred snippet.
    byUrl.get(url).push({ source: parsed.data, truncated: audit.sourceExcerpts.length > excerptCount });
  });
  return byUrl;
}

/**
 * Inject into the backend ResearchAgent slot. This module never fetches, loads
 * env files, persists artifacts, or retries; complete owns transport/budgets.
 * complete({body, signal, timeoutMs}) returns {message, finishReason, usage?,
 * searchCalls?}. saveAudit is mandatory and must persist by audit.id, separately
 * from the v2 artifact. It is awaited before any artifact is returned.
 * An audit ID is written at most once. The saved snapshot records generation,
 * not delivery: cancellation during persistence rejects the artifact with that
 * audit ID, without overwriting or appending to an already persisted audit.
 * The deadline signals cancellation to complete; timely settlement depends on
 * a cooperative transport. This adapter waits for the receipt/error and audit,
 * and rejects late completions, rather than claiming an independent hard stop.
 */
export function createThinResearchAgent({
  researchBriefSchema, researchArtifactSchema, researchSourceSchema, verificationRecordSchema,
  classifyResearchSourceAuthority, verifyResearchFinding, model, complete, saveAudit,
  now = () => new Date(), modelOptions = {},
} = {}) {
  const schemas = { researchBriefSchema, researchArtifactSchema, researchSourceSchema, verificationRecordSchema };
  for (const [name, schema] of Object.entries(schemas)) {
    if (typeof schema?.parse !== 'function' || typeof schema?.safeParse !== 'function') throw new TypeError(`${name} is required`);
  }
  if (typeof model !== 'string' || !model.trim() || model.length > 160) throw new TypeError('model is required');
  if (typeof complete !== 'function' || typeof saveAudit !== 'function' || typeof now !== 'function') throw new TypeError('complete, saveAudit and now must be functions');
  for (const fn of [classifyResearchSourceAuthority, verifyResearchFinding]) {
    if (fn !== undefined && typeof fn !== 'function') throw new TypeError('Domain verification dependencies must be functions');
  }
  const maxTokens = modelOptions.maxTokens ?? 3200;
  const timeoutMs = modelOptions.timeoutMs ?? 95000;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4000 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 95000) {
    throw new TypeError('Model token/deadline limits are outside the experiment bounds');
  }

  return {
    async research(input, context) {
      const started = performance.now();
      const audit = { id: `thin_audit_${randomUUID()}`, requestId: context?.requestId ?? null, model,
        startedAt: new Date().toISOString(), status: 'running', stage: 'input', modelCalls: 0,
        raw: null, normalization: null, disposition: null, effectiveDisposition: null, uncertainties: [],
        sourceExcerpts: [], sourceIssues: [], rejectedFindings: [], warnings: [], artifactId: null };
      const callerSignal = context?.signal;
      let signal;
      let auditPersisted = false;
      const persist = async () => {
        if (auditPersisted) return;
        audit.elapsedMs = performance.now() - started;
        audit.finishedAt = new Date().toISOString();
        try {
          await saveAudit(structuredClone(audit));
          auditPersisted = true;
        }
        catch (error) {
          const failure = new ThinResearchError('THIN_RESEARCH_AUDIT_SAVE_FAILED', 'Research audit could not be persisted', errorIdentity(error));
          failure.auditId = audit.id;
          failure.audit = structuredClone(audit);
          throw failure;
        }
      };
      try {
        signal = callerSignal ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
        abortIfNeeded(signal, callerSignal);
        const preferences = checkedContext(context);
        const checkedBrief = researchBriefSchema.safeParse(structuredClone(input));
        if (!checkedBrief.success) fail('INVALID_RESEARCH_BRIEF', 'Research brief failed the domain contract',
          checkedBrief.error.issues.map(issue => ({ code: issue.code, path: issue.path })));
        const brief = checkedBrief.data;
        const clock = now();
        if (!(clock instanceof Date) || Number.isNaN(clock.getTime())) fail('THIN_RESEARCH_CLOCK_INVALID', 'Research clock is invalid');
        const checkedAt = clock.toISOString();
        const testCase = { request: brief.questions.join('\n'), brief: { ...brief, maxResults: brief.maxResults ?? 10 } };
        audit.input = { brief: structuredClone(brief), preferenceSummary: preferences };
        const messages = researchMessages(testCase, true, checkedAt);
        const user = JSON.parse(messages[1].content);
        user.preferenceSummary = preferences;
        messages[1].content = JSON.stringify(user);
        const body = { model, messages, max_tokens: maxTokens,
          ...(modelOptions.temperature === null ? {} : { temperature: modelOptions.temperature ?? 0 }),
          reasoning: modelOptions.reasoning ?? { enabled: false, exclude: true },
          provider: { require_parameters: true, allow_fallbacks: true },
          tools: [{ type: 'openrouter:web_search', parameters: { engine: 'exa', max_results: 5,
            max_total_results: 10, max_uses: 2, max_characters: 800 } }], max_tool_calls: 2,
          response_format: { type: 'json_schema', json_schema: { name: 'travel_candidates', strict: true, schema: schemaForCase(testCase) } } };
        audit.request = structuredClone(body);
        audit.stage = 'model';
        abortIfNeeded(signal, callerSignal);
        audit.modelCalls = 1;
        const modelStarted = performance.now();
        let receipt;
        try { receipt = await complete({ body, signal, timeoutMs }); }
        catch (error) { audit.modelError = errorIdentity(error); throw error; }
        finally { audit.modelElapsedMs = performance.now() - modelStarted; }
        if (!isObject(receipt)) fail('THIN_RESEARCH_MODEL_RESPONSE_INVALID', 'Research transport returned no completion receipt');
        audit.raw = structuredClone(receipt.message ?? null);
        audit.receipt = { id: receipt.id ?? null, model: receipt.model ?? null, provider: receipt.provider ?? null,
          finishReason: receipt.finishReason ?? null, usage: structuredClone(receipt.usage ?? null), searchCalls: receipt.searchCalls ?? null };
        abortIfNeeded(signal, callerSignal);
        if (receipt.message?.role !== 'assistant' || typeof receipt.message.content !== 'string' || !receipt.message.content.trim()) {
          fail('THIN_RESEARCH_MODEL_RESPONSE_INVALID', 'Research response has no assistant content');
        }
        if (receipt.message.content.length > 100000) fail('THIN_RESEARCH_MODEL_RESPONSE_INVALID', 'Research content exceeds its bound');
        if (receipt.finishReason !== 'stop' || receipt.message.tool_calls?.length) {
          fail('THIN_RESEARCH_MODEL_INCOMPLETE', 'Research response did not finish its work');
        }
        const annotations = receipt.message.annotations ?? [];
        if (!Array.isArray(annotations)) fail('THIN_RESEARCH_MODEL_RESPONSE_INVALID', 'Research annotations are malformed');
        audit.stage = 'normalization';
        const citations = citationSources(receipt.message);
        const normalized = normalizeResearchResponse(receipt.message.content, testCase, citations);
        audit.normalization = normalized;
        audit.disposition = normalized.normalized.disposition ?? null;
        audit.uncertainties = structuredClone(normalized.normalized.uncertainties ?? []);
        if (!normalized.normalized.valid) fail('THIN_RESEARCH_OUTPUT_INVALID', 'Research response failed the shared contract', normalized.normalized.errors);
        audit.stage = 'accounting';
        const queryCount = countedSearches(receipt);
        audit.queryCount = queryCount;
        audit.stage = 'sources';
        const byUrl = admittedSources(annotations, schemas, classifyResearchSourceAuthority, audit);
        const findings = [];
        for (const [index, finding] of normalized.normalized.findings.entries()) {
          if (audit.disposition === 'clarify') {
            audit.rejectedFindings.push({ index, code: 'clarification_required' });
            continue;
          }
          const missing = finding.sourceUrls.filter(url => !byUrl.has(url));
          if (missing.length) { audit.rejectedFindings.push({ index, code: 'source_unavailable', urls: missing }); continue; }
          const admitted = finding.sourceUrls.flatMap(url => byUrl.get(url));
          if (admitted.length > 20) { audit.rejectedFindings.push({ index, code: 'source_count_exceeds_domain_limit' }); continue; }
          const sources = admitted.map(value => value.source);
          audit.stage = 'verification';
          const verification = verificationRecordSchema.parse(verifyResearchFinding
            ? verifyResearchFinding(finding.category, structuredClone(sources), { checkedAt })
            : { status: 'unverified', confidence: 0, checkedAt,
              sources: sources.map(source => ({ provider: 'research-search', reference: source.url })) });
          if (verification.status === 'verified') fail('THIN_RESEARCH_VERIFICATION_POLICY_INVALID', 'Snippet evidence cannot become verified');
          const warnings = ['research_evidence_is_snippet_only', `evidence_${verification.status}`];
          if (finding.category === 'event') warnings.push('event_date_is_snippet_only');
          if (admitted.some(value => value.truncated)) warnings.push('source_excerpt_truncated');
          findings.push({ id: `finding_${digest({ destination: brief.destinations[finding.destinationIndex], finding, sources })}`,
            category: finding.category, destinations: [structuredClone(brief.destinations[finding.destinationIndex])],
            title: finding.title, summary: finding.summary, sources, verification, warnings });
        }
        audit.effectiveDisposition = audit.disposition === 'clarify' ? 'clarify'
          : audit.disposition === 'partial' || audit.rejectedFindings.length || !findings.length ? 'partial' : 'recommend';
        const warnings = [`thin_research_audit:${audit.id}`, `thin_research_disposition:${audit.effectiveDisposition}`, 'research_evidence_is_snippet_only'];
        if (normalized.transforms.length) warnings.push('thin_research_structure_normalized');
        if (audit.rejectedFindings.length) warnings.push(`thin_research_findings_excluded:${audit.rejectedFindings.length}`);
        if (!findings.length) warnings.push('thin_research_no_admissible_findings');
        if (findings.some(finding => finding.warnings.includes('source_excerpt_truncated'))) warnings.push('source_excerpt_truncated');
        audit.uncertainties.forEach((uncertainty, index) => {
          warnings.push(uncertainty.length <= 240 ? uncertainty : `thin_research_uncertainty_in_audit:${index}:exceeds_240_chars`);
        });
        audit.warnings = warnings;
        audit.stage = 'artifact';
        const artifact = researchArtifactSchema.parse({ id: `research_${randomUUID()}`, type: 'research', schemaVersion: 2,
          brief, findings, queryCount, warnings, createdAt: checkedAt });
        abortIfNeeded(signal, callerSignal);
        audit.artifactId = artifact.id;
        audit.acceptedFindingCount = findings.length;
        audit.status = audit.effectiveDisposition;
        audit.stage = 'finished';
        await persist();
        abortIfNeeded(signal, callerSignal);
        return artifact;
      } catch (error) {
        if (error?.code === 'THIN_RESEARCH_AUDIT_SAVE_FAILED') throw error;
        const failure = error instanceof ThinResearchError ? error : new ThinResearchError(
          callerSignal?.aborted ? 'RESEARCH_CANCELLED' : signal?.aborted ? 'THIN_RESEARCH_TIMEOUT'
            : audit.stage === 'model' ? 'THIN_RESEARCH_MODEL_FAILED' : 'THIN_RESEARCH_FAILED',
          'Thin research did not return a usable artifact', errorIdentity(error));
        audit.status = callerSignal?.aborted ? 'cancelled' : signal?.aborted ? 'timeout' : 'failed';
        audit.error = { ...errorIdentity(failure), details: failure.details ?? null };
        failure.auditId = audit.id;
        await persist();
        throw failure;
      }
    },
  };
}
