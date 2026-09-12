import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadBackend} from './baseline.mjs';
import {createThinResearchAgent} from './thin-research.mjs';
import {createFixture, runResearchScenario, integrationScope} from './planner-integration.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const archive = resolve(here, '../travel-research/results/2026-09-13');
const protocol = 'research-v3-aligned-contract-routing';
const candidateModels = ['qwen/qwen3.8-flash', 'z-ai/glm-5.3-flash'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const identity = error => ({name: error?.name ?? 'Error', code: error?.code ?? null,
  message: error?.message ?? String(error)});
const codePaths = ['backend-replay.mjs', 'planner-integration.mjs', 'thin-research.mjs', 'baseline.mjs',
  '../travel-research/contracts.mjs', '../travel-research/normalization.mjs'];
const codeFiles = () => codePaths.map(path => ({path, sha256: hash(readFileSync(join(here, path)))}));

function archiveFile(path) {
  const full = resolve(archive, path);
  const rel = relative(archive, full);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('BACKEND_REPLAY_SOURCE_OUTSIDE_ARCHIVE');
  }
  return full;
}

function sourceSet() {
  const cases = readJson(join(archive, 'inputs/cases.json'));
  const models = readJson(join(archive, 'inputs/models.json'));
  const rows = readJson(join(archive, 'all-results.json')).rows.filter(row =>
    row.protocol === protocol && row.arm === 'thin-web' && candidateModels.includes(row.model));
  const expected = candidateModels.flatMap(model => cases.map(testCase => `${model}:${testCase.id}`));
  const actual = new Set(rows.map(row => `${row.model}:${row.caseId}`));
  if (cases.length !== 16 || expected.length !== 32 || rows.length !== 32 || actual.size !== 32
    || expected.some(key => !actual.has(key))) throw new Error('BACKEND_REPLAY_COVERAGE_MISMATCH');
  const inputs = ['archive-manifest.json', 'all-results.json', 'inputs/cases.json', 'inputs/models.json'];
  const files = [...inputs, ...rows.map(row => row.sourceFile)].sort().map(path => ({
    path, sha256: hash(readFileSync(archiveFile(path))),
  }));
  return {cases, models, rows, files, hash: hash(JSON.stringify(files))};
}

function observedOutcome(report, fixture) {
  const tools = report?.toolOutputs ?? fixture?.toolOutputs ?? [];
  const tool = name => tools.findLast(entry => entry.name === name);
  const research = tool('web_research');
  const save = tool('save_travel_guide');
  const finish = tool('finish_goal');
  const researchArtifact = report?.artifacts?.find(record => record.type === 'research');
  const findings = researchArtifact?.payload.findings ?? [];
  return {
    research: {attempted: Boolean(research), toolOk: research?.outcome.ok ?? false,
      errorCode: research?.outcome.errorCode ?? null, persisted: Boolean(researchArtifact),
      findingCount: findings.length, verificationEligibleFindingCount: findings.filter(finding =>
        ['verified', 'partially_verified'].includes(finding.verification.status)).length,
      verificationCounts: Object.fromEntries(['verified', 'partially_verified', 'unverified', 'stale'].map(status =>
        [status, findings.filter(finding => finding.verification.status === status).length]))},
    saveGuide: {attempted: Boolean(save), toolOk: save?.outcome.ok ?? false,
      status: save?.output.data?.status ?? null, errorCode: save?.outcome.errorCode ?? null,
      issues: save?.output.data?.issues ?? []},
    finishGoal: {attempted: Boolean(finish), toolOk: finish?.outcome.ok ?? false,
      verificationStatus: finish?.output.data?.verification?.status ?? null,
      errorCode: finish?.outcome.errorCode ?? null},
    deliveryStatus: report?.result?.delivery?.status ?? null,
    stopReason: report?.result?.stopReason ?? null,
    satisfied: report?.result?.delivery?.status === 'satisfied',
  };
}

function grouped(rows) {
  return candidateModels.map(model => {
    const items = rows.filter(row => row.model === model);
    return {model, samples: items.length,
      researchPersisted: items.filter(row => row.observed.research.persisted).length,
      nonemptyResearch: items.filter(row => row.observed.research.findingCount > 0).length,
      providerRejected: items.filter(row => row.providerStatus === 'rejected').length,
      verificationEligibleFindingSamples: items.filter(row => row.observed.research.verificationEligibleFindingCount > 0).length,
      guideSaved: items.filter(row => row.observed.saveGuide.status === 'saved').length,
      satisfied: items.filter(row => row.observed.satisfied).length,
      replayErrors: items.filter(row => row.error).length,
      receiptReads: items.reduce((total, row) => total + row.receiptReads, 0),
      scriptedPlannerCalls: items.reduce((total, row) => total + row.scriptedPlannerCalls, 0),
      newLiveModelCalls: 0};
  });
}

/** Offline vertical replay only. The real Planner's decisions are scripted by
 * the unchanged integration fixture; this is not a production workflow. */
export async function replayBackend(output = join(here, '.runs', `backend-replay-${randomUUID()}`)) {
  output = resolve(output);
  const archiveRelative = relative(archive, output);
  if (!archiveRelative || (!archiveRelative.startsWith('..') && !isAbsolute(archiveRelative))) {
    throw new Error('BACKEND_REPLAY_OUTPUT_MUST_NOT_MUTATE_ARCHIVE');
  }
  mkdirSync(dirname(output), {recursive: true});
  mkdirSync(output); // Deliberately refuse reuse or overwrite of any prior run.
  mkdirSync(join(output, 'audits'));
  mkdirSync(join(output, 'samples'));
  const previousFetch = globalThis.fetch;
  let networkAttempts = 0;
  let backend;
  const startedAt = new Date().toISOString();
  const rows = [];
  globalThis.fetch = async () => { networkAttempts++; throw new Error('OFFLINE_NETWORK_DISABLED'); };
  try {
    const source = sourceSet();
    const files = codeFiles();
    backend = await loadBackend();
    const manifest = {schemaVersion: 1, scope: integrationScope, startedAt, sourceProtocol: protocol,
      expectedSamples: 32, sourceHash: source.hash, sourceFiles: source.files,
      baselineHash: backend.manifest.sourceHash, codeHash: hash(JSON.stringify(files)), files,
      boundaries: {
        transport: 'Exact archived receipt, cloned once per request. No new model, search or API call.',
        planner: 'Offline scripted decisions through real CloudPlannerService, AgentRuntime and Planner registry. attemptGuide=true; unchanged fixture selection and domain verification.',
        persistence: 'Independent owner and in-memory repositories per sample; real Goal/run relation resolver and Trip-version callback. No DB, server or port.',
        clock: 'Research checkedAt uses the original sample startedAt; backend/runtime clocks retain actual replay time. Trip dates and domain policy are unchanged.',
        evidence: 'Archived receipts were generated from full user request plus brief; adapter prompts use the brief. This checks recorded-output integration, not fresh model behavior, factual truth, quality ranking, latency or Planner autonomy.',
        selection: 'The scripted guide distributes findings across days under the first destination. Rejections, including multi-city/date/coverage limitations, are retained without tuning.',
        networkGuard: 'globalThis.fetch is blocked and restored in finally; no production transport is injected. This is not an OS-level network sandbox.',
        dependencies: backend.manifest.dependencies,
      }};
    writeJson(join(output, 'manifest.json'), manifest);
    writeJson(join(output, 'baseline-manifest.json'), backend.manifest);
    for (const row of source.rows) {
      const sampleFile = `samples/sample-${String(rows.length + 1).padStart(3, '0')}.json`;
      const sourcePath = archiveFile(row.sourceFile);
      const sourceBytes = readFileSync(sourcePath);
      if (hash(sourceBytes) !== source.files.find(file => file.path === row.sourceFile).sha256) {
        throw new Error('BACKEND_REPLAY_SOURCE_CHANGED');
      }
      const original = JSON.parse(sourceBytes.toString('utf8'));
      const receipt = original.trace?.at(-1)?.response;
      const recordedAt = original.startedAt;
      if (original.model !== row.model || original.caseId !== row.caseId || original.arm !== 'thin-web'
        || recordedAt !== row.startedAt || !Number.isFinite(Date.parse(recordedAt)) || !receipt) {
        throw new Error('BACKEND_REPLAY_SOURCE_IDENTITY_INVALID');
      }
      const testCase = source.cases.find(value => value.id === row.caseId);
      const model = source.models.find(value => value.id === row.model);
      const result = {sampleId: row.id, caseId: row.caseId, model: row.model, sampleFile,
        sourceFile: row.sourceFile, sourceSha256: hash(sourceBytes), receiptSha256: hash(JSON.stringify(receipt)),
        recordedAt, travelWindow: testCase.brief.travelWindow,
        recordedStatus: row.status, recordedRawValid: row.result?.valid ?? false,
        ownerId: `backend-replay-${randomUUID()}`, receiptReads: 0,
        newLiveModelCalls: 0, newApiCostUsd: 0, auditFiles: [], providerStatus: 'not_called'};
      let fixture;
      const beforeNetwork = networkAttempts;
      try {
        fixture = await createFixture({backend, testCase, ownerId: result.ownerId,
          researchFactory: ({modules, audits}) => createThinResearchAgent({...modules, model: row.model,
            modelOptions: {reasoning: model.reasoning ?? {enabled: false, exclude: true}},
            now: () => new Date(recordedAt),
            complete: async ({body, signal}) => {
              signal.throwIfAborted();
              if (body.model !== row.model) throw new Error('BACKEND_REPLAY_MODEL_MISMATCH');
              result.receiptReads++;
              if (result.receiptReads !== 1) throw new Error('BACKEND_REPLAY_RETRY_FORBIDDEN');
              return structuredClone(receipt);
            },
            saveAudit: async audit => {
              if (!/^thin_audit_[a-f0-9-]+$/.test(audit.id)) throw new Error('BACKEND_REPLAY_AUDIT_ID_INVALID');
              const auditFile = `audits/${audit.id}.json`;
              writeJson(join(output, auditFile), audit);
              result.auditFiles.push(auditFile);
              audits.push(structuredClone(audit));
            },
          }),
        });
        result.report = await runResearchScenario(fixture, {attemptGuide: true});
      } catch (error) { result.error = identity(error); }
      finally {
        try { await fixture?.close(); }
        catch (error) { result.closeError = identity(error); }
      }
      result.auditStatus = fixture?.audits.at(-1)?.status ?? null;
      result.providerStatus = ['failed', 'cancelled', 'timeout'].includes(result.auditStatus) ? 'rejected'
        : ['recommend', 'partial', 'clarify'].includes(result.auditStatus) ? 'artifact' : 'not_called';
      result.providerError = fixture?.audits.at(-1)?.error ?? null;
      result.effectiveDisposition = fixture?.audits.at(-1)?.effectiveDisposition ?? null;
      result.scriptedPlannerCalls = fixture?.modelCalls.length ?? 0;
      result.researchCalls = fixture?.researchCalls ?? 0;
      result.networkAttempts = networkAttempts - beforeNetwork;
      // Even a thrown script/runtime keeps the actual tool outputs and persisted state.
      if (!result.report && fixture) result.partialState = {toolOutputs: fixture.toolOutputs,
        artifacts: await fixture.artifacts.listForTrip(fixture.trip.id, 100),
        goals: await fixture.goals.listForTrip(fixture.trip.id)};
      result.observed = observedOutcome(result.report ?? result.partialState, fixture);
      result.integrityErrors = [];
      if (fixture?.modelCalls.some(call => call.model !== 'offline/scripted-planner')) result.integrityErrors.push('UNEXPECTED_PLANNER_MODEL');
      if (result.researchCalls !== 1 || result.receiptReads !== 1 || result.auditFiles.length !== 1) result.integrityErrors.push('REPLAY_CALL_OR_AUDIT_COUNT');
      if (result.networkAttempts) result.integrityErrors.push('UNEXPECTED_NETWORK_ATTEMPT');
      writeJson(join(output, sampleFile), result);
      rows.push(result);
      console.log(JSON.stringify({sampleFile, caseId: row.caseId, model: row.model,
        providerStatus: result.providerStatus, ...result.observed, receiptReads: result.receiptReads}));
    }
    const summary = {manifest: {...manifest, finishedAt: new Date().toISOString(), networkAttempts,
      newLiveModelCalls: 0, newApiCostUsd: 0, completedSamples: rows.length,
      codeUnchanged: hash(JSON.stringify(codeFiles())) === manifest.codeHash,
      sourceUnchanged: sourceSet().hash === manifest.sourceHash}, groups: grouped(rows),
      rows: rows.map(({report, partialState, ...row}) => row)};
    summary.valid = summary.manifest.codeUnchanged && summary.manifest.sourceUnchanged && networkAttempts === 0
      && rows.length === 32 && rows.every(row => !row.error && !row.closeError && row.integrityErrors.length === 0);
    writeJson(join(output, 'backend-replay.json'), summary);
    console.log(JSON.stringify({output, valid: summary.valid, completedSamples: rows.length, networkAttempts,
      sourceHash: manifest.sourceHash, baselineHash: manifest.baselineHash, codeHash: manifest.codeHash,
      newLiveModelCalls: 0, newApiCostUsd: 0, groups: summary.groups}));
    return summary;
  } catch (error) {
    writeJson(join(output, 'fatal-error.json'), {startedAt, failedAt: new Date().toISOString(),
      completedSamples: rows.length, networkAttempts, error: identity(error)});
    throw error;
  } finally {
    globalThis.fetch = previousFetch;
    await backend?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3) throw new Error('Usage: node backend-replay.mjs [NEW_OUTPUT_DIRECTORY]');
  const summary = await replayBackend(process.argv[2]);
  if (!summary.valid) process.exitCode = 1;
}
