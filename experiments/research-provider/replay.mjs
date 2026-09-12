import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadBackend} from './baseline.mjs';
import {createThinResearchAgent} from './thin-research.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const archive = resolve(here, '../travel-research/results/2026-09-13');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export async function replayCandidates(output = join(here, '.runs/candidate-replay')) {
  output = resolve(output);
  mkdirSync(dirname(output), {recursive: true}); mkdirSync(output);
  mkdirSync(join(output, 'audits')); mkdirSync(join(output, 'samples'));
  const previousFetch = globalThis.fetch;
  let networkAttempts = 0;
  let backend;
  globalThis.fetch = async () => { networkAttempts++; throw new Error('OFFLINE_NETWORK_DISABLED'); };
  try {
    backend = await loadBackend();
    const modules = Object.assign({}, ...await Promise.all([
      'research-agent/types.ts', 'research-agent/verification.ts', 'aviation/types.ts',
    ].map(file => backend.import(file))));
    const cases = json(join(archive, 'inputs/cases.json'));
    const models = json(join(archive, 'inputs/models.json'));
    const rows = json(join(archive, 'all-results.json')).rows.filter(row =>
      row.protocol === 'research-v3-aligned-contract-routing' && row.arm === 'thin-web'
      && ['qwen/qwen3.8-flash', 'z-ai/glm-5.3-flash'].includes(row.model));
    if (rows.length !== 32 || new Set(rows.map(row => `${row.model}:${row.caseId}`)).size !== 32) throw new Error('REPLAY_COVERAGE_MISMATCH');
    const results = [];
    for (const row of rows) {
      const originalPath = join(archive, row.sourceFile);
      const original = json(originalPath);
      const testCase = cases.find(value => value.id === row.caseId);
      const model = models.find(value => value.id === row.model);
      const audits = [];
      let completionCalls = 0;
      const provider = createThinResearchAgent({...modules, model: row.model,
        modelOptions: {reasoning: model.reasoning ?? {enabled: false, exclude: true}},
        now: () => new Date(row.startedAt),
        complete: async ({body, signal}) => {
          signal.throwIfAborted();
          if (body.model !== row.model) throw new Error('REPLAY_MODEL_MISMATCH');
          completionCalls++;
          if (completionCalls !== 1) throw new Error('REPLAY_RETRY_FORBIDDEN');
          // Exact archived receipt. No inferred zero search count, new evidence,
          // rewritten response, or live model invocation is introduced here.
          return structuredClone(original.trace.at(-1).response);
        },
        saveAudit: async audit => {
          if (!/^thin_audit_[a-f0-9-]+$/.test(audit.id)) throw new Error('REPLAY_AUDIT_ID_INVALID');
          writeFileSync(join(output, 'audits', `${audit.id}.json`), JSON.stringify(audit, null, 2) + '\n', {flag: 'wx'});
          audits.push(structuredClone(audit));
        },
      });
      const result = {sampleId: row.id, caseId: row.caseId, model: row.model,
        sourceFile: relative(here, originalPath).replaceAll('\\', '/'),
        sourceSha256: hash(readFileSync(originalPath)),
        recordedStatus: row.status, recordedRawValid: row.result?.valid ?? false};
      try {
        result.artifact = await provider.research(testCase.brief, {requestId: `replay-${row.caseId}`});
        result.status = 'artifact';
      } catch (error) {
        result.status = 'rejected';
        result.error = {name: error.name, code: error.code ?? 'UNCLASSIFIED_ERROR'};
      }
      result.completionCalls = completionCalls;
      result.audit = audits.at(-1) ?? null;
      if (!result.audit) throw new Error('REPLAY_AUDIT_MISSING');
      result.auditFile = `audits/${result.audit.id}.json`;
      result.sampleFile = `samples/sample-${String(results.length + 1).padStart(3, '0')}.json`;
      writeFileSync(join(output, result.sampleFile), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
      results.push(result);
    }
    const groups = [...new Set(results.map(row => row.model))].map(model => {
      const items = results.filter(row => row.model === model);
      const findings = items.flatMap(row => row.artifact?.findings ?? []);
      return {model, samples: items.length, artifacts: items.filter(row => row.artifact).length,
        nonemptyArtifacts: items.filter(row => row.artifact?.findings.length).length,
        clarificationArtifacts: items.filter(row => row.audit?.effectiveDisposition === 'clarify' && row.artifact).length,
        rejected: items.filter(row => row.status === 'rejected').map(row => ({caseId: row.caseId, code: row.error.code})),
        findings: findings.length, partiallyVerified: findings.filter(row => row.verification.status === 'partially_verified').length,
        unverified: findings.filter(row => row.verification.status === 'unverified').length,
        verified: findings.filter(row => row.verification.status === 'verified').length,
        sourceExcerpts: items.reduce((n, row) => n + row.audit.sourceExcerpts.length, 0),
        excludedFindings: items.reduce((n, row) => n + row.audit.rejectedFindings.length, 0)};
    });
    const manifest = {generatedAt: new Date().toISOString(), scope: 'offline-provider-contract-replay',
      baselineHash: backend.manifest.sourceHash, networkAttempts, newApiCostUsd: 0,
      sourceProtocol: 'research-v3-aligned-contract-routing',
      limitation: 'Reuses recorded responses originally generated with full user request plus brief. This checks domain conversion, not fresh model behavior, latency, factual accuracy, or Planner autonomy.',
      files: ['thin-research.mjs', 'replay.mjs', 'baseline.mjs'].map(path => ({path, sha256: hash(readFileSync(join(here, path)))}))};
    if (networkAttempts) throw new Error('UNEXPECTED_NETWORK_ATTEMPT');
    save(join(output, 'provider-replay.json'), {manifest, groups, rows: results});
    save(join(output, 'baseline-manifest.json'), backend.manifest);
    console.log(JSON.stringify({output, ...manifest, groups}));
    return {manifest, groups, rows: results};
  } finally {
    globalThis.fetch = previousFetch;
    await backend?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await replayCandidates(process.argv[2]);
}
