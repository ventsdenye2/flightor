// Offline, allowlisted evidence export. Never reads .env files or contacts APIs.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const unix = value => value.replaceAll('\\', '/');
const forbiddenKey = key => /^(?:authorization|proxy-authorization|headers|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|cookie|set-cookie)$/i.test(key);
const credentialPattern = /(?:sk-or-v1-[a-zA-Z0-9_-]{16,}|sk-[a-zA-Z0-9_-]{24,}|Bearer\s+[a-zA-Z0-9._-]{16,})/i;
const absolutePathPattern = /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\\\s]+\\|\/(?:Users|home|tmp|mnt|workspaces)\/)/;

export function exportResults() {
  const runs = join(here, '.runs');
  const output = join(here, 'results', '2026-09-13');
  if (existsSync(output)) throw new Error('ARCHIVE_EXISTS: use the committed archive; do not overwrite evidence');
  const sourceEntries = new Map();
  const generated = new Map();
  const pathAliases = new Map();
  const knownSecrets = ['OPENROUTER_API_KEY', 'SERPAPI_KEY', 'SERPAPI_API_KEY']
    .map(key => process.env[key]).filter(value => typeof value === 'string' && value.length >= 8);
  let redactedFields = false;
  let redactedCredentialValue = false;

  function readSource(sourceId, archivedAs, origin = runs) {
    const path = join(origin, sourceId);
    const bytes = readFileSync(path);
    const identity = origin === runs ? sourceId : `experiment/${sourceId}`;
    sourceEntries.set(identity, {
      sourceId: identity, sha256: sha256(bytes), bytes: bytes.length,
      ...(archivedAs ? { archivedAs } : { use: 'selection or supporting source metadata' })
    });
    if (archivedAs) pathAliases.set(unix(path), archivedAs);
    return bytes.toString('utf8');
  }
  const readJson = (sourceId, archivedAs, origin) => JSON.parse(readSource(sourceId, archivedAs, origin));
  const aggregate = readJson('aggregate-final/all-results.json', 'all-results.json');
  assert.equal(aggregate.rows.length, 106, 'the archived selection must contain the verified 106 actual samples');
  const batches = aggregate.manifests.map(manifest => basename(manifest.directory));
  assert.equal(new Set(batches).size, batches.length);
  assert.ok(batches.every(name => /^[a-z0-9-]+$/.test(name)));
  const sampleIds = new Set(aggregate.rows.map(row => row.id));
  assert.equal(sampleIds.size, 106);

  // Map every archived source before sanitizing, so error strings and JSON file
  // references can resolve to committed evidence instead of local .runs paths.
  for (const name of batches) {
    pathAliases.set(unix(join(runs, name)), `runs/${name}`);
  }
  pathAliases.set(unix(join(runs, 'aggregate-final')), '.');
  pathAliases.set(unix(runs), 'source-runs');
  pathAliases.set(unix(here), 'experiment');

  function cleanText(value) {
    let text = value;
    for (const secret of knownSecrets) {
      if (text.includes(secret)) {
        redactedCredentialValue = true;
        text = text.split(secret).join('[redacted]');
      }
    }
    text = text.replace(/(?:sk-or-v1-[a-zA-Z0-9_-]{16,}|sk-[a-zA-Z0-9_-]{24,}|Bearer\s+[a-zA-Z0-9._-]{16,})/gi, () => {
      redactedCredentialValue = true;
      return '[redacted]';
    });
    text = text.replace(/([?&](?:api[_-]?key|access_token|token|authorization|signature|sig)=)[^\s&#"<>]+/gi, '$1[redacted]');
    const aliases = [...pathAliases].sort(([left], [right]) => right.length - left.length);
    for (const [source, target] of aliases) {
      text = text.split(source).join(target).split(source.replaceAll('/', '\\')).join(target);
    }
    // Non-evidence local paths (for example backend roots in error messages)
    // are environment metadata; preserve the error while removing that path.
    return text
      .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n"<>|?*]*/g, '[local-path]')
      .replace(/\\\\[^\r\n"<>|?*]+/g, '[local-path]')
      .replace(/\/(?:Users|home|tmp|mnt|workspaces)\/[^\s"<>]+/g, '[local-path]');
  }
  function clean(value) {
    if (typeof value === 'string') return cleanText(value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).filter(([key]) => {
        if (!forbiddenKey(key)) return true;
        redactedFields = true;
        return false;
      }).map(([key, item]) => [key, clean(item)]));
    }
    return value;
  }
  const addJson = (path, value, compact = false) => generated.set(path, JSON.stringify(clean(value), null, compact ? undefined : 2) + '\n');
  const addText = (path, value) => generated.set(path, cleanText(value));
  function compactRow(row, sourceId) {
    const result = pick(row, ['id', 'caseId', 'model', 'arm', 'repetition', 'engine', 'startedAt', 'elapsedMs',
      'status', 'content', 'citations', 'result', 'error', 'knownOpenRouterUsd', 'unknownCostCalls',
      'searchCalls', 'serverSearchCalls', 'protocol', 'concurrency']);
    result.sourceFile = `runs/${sourceId}.json`;
    result.trace = (row.trace ?? []).map(trace => ({
      ...pick(trace, ['startedAt', 'elapsedMs', 'httpStatus', 'billingDisposition', 'providerError', 'error']),
      requestHash: trace.request ? sha256(JSON.stringify(trace.request)) : null,
      requestConfig: pick(trace.request, ['model', 'max_tokens', 'temperature', 'reasoning', 'response_format',
        'provider', 'tools', 'max_tool_calls']),
      ...('response' in trace ? { response: pick(trace.response, ['id', 'model', 'provider', 'usage', 'finishReason', 'message']) } : {})
    }));
    if (row.currentSystem) {
      result.currentSystem = pick(row.currentSystem, ['artifact', 'searchCalls', 'warnings', 'raw']);
    }
    return result;
  }
  function compactManifest(manifest) {
    return pick(manifest, ['startedAt', 'plan', 'models', 'casesHash', 'modelsHash', 'baselineHash', 'runnerFiles']);
  }

  const manifestRows = [];
  const counts = [];
  const originalRows = new Map();
  for (const name of batches) {
    const manifestPath = `runs/${name}/manifest.json`;
    const manifest = readJson(`${name}/manifest.json`, manifestPath);
    const compact = compactManifest(manifest);
    addJson(manifestPath, compact);
    manifestRows.push({ directory: `runs/${name}`, ...compact });
    const sourceFiles = readdirSync(join(runs, name)).filter(file => /^sample-\d+\.json$/.test(file)).sort();
    for (const file of sourceFiles) {
      const sourceId = `${name}/${file.slice(0, -5)}`;
      assert.ok(sampleIds.has(sourceId), 'do not silently include samples outside the final selection');
      const row = readJson(`${name}/${file}`, `runs/${name}/${file}`);
      assert.equal(row.id, file.slice(0, -5));
      originalRows.set(sourceId, row);
      addJson(`runs/${name}/${file}`, compactRow(row, sourceId), true);
    }
    counts.push({ run: name, samples: sourceFiles.length, protocol: manifest.plan.protocol ?? 'research-v1',
      concurrency: manifest.plan.concurrency ?? 1 });
    const baselineId = `${name}/baseline-manifest.json`;
    if (existsSync(join(runs, baselineId))) {
      const baseline = readJson(baselineId, `runs/${name}/baseline-manifest.json`);
      addJson(`runs/${name}/baseline-manifest.json`, pick(baseline,
        ['head', 'branch', 'backendStatus', 'files', 'dependencies', 'sourceHash']));
    }
  }
  assert.equal(originalRows.size, 106);
  for (const row of aggregate.rows) {
    const original = originalRows.get(row.id);
    assert.ok(original, 'aggregate rows must resolve to archived original samples');
    for (const key of ['caseId', 'model', 'arm', 'status', 'content']) assert.equal(row[key], original[key]);
  }
  const archivedRows = aggregate.rows.map(row => compactRow(row, row.id));
  addJson('all-results.json', { manifests: manifestRows, rows: archivedRows }, true);
  for (const file of ['cases.json', 'models.json', 'rubric.md']) {
    const content = readSource(file, `inputs/${file}`, here);
    if (file.endsWith('.json')) addJson(`inputs/${file}`, JSON.parse(content));
    else addText(`inputs/${file}`, content);
  }
  for (const file of ['normalization-results.json', 'blind-review.json', 'architecture-metrics.json']) {
    const value = readJson(`aggregate-final/${file}`, file);
    addJson(file, value, file !== 'architecture-metrics.json');
  }
  const report = readSource('aggregate-final/report.md', 'report.md')
    .replaceAll('共享 budget-ledger.json', '共享 [budget-ledger.json](receipts/budget-ledger.json)');
  addText('report.md', report);

  const receipts = readdirSync(runs).filter(file => /^(?:budget-ledger|serpapi-account-(?:before|after)-baseline|billing-review(?:-\d+)?|key-usage-review|timeout-billing-review)\.json$/.test(file));
  for (const file of receipts) addJson(`receipts/${file}`, readJson(file, `receipts/${file}`));
  const verification = readJson('final-verification.json', 'verification/offline-tests.json');
  assert.deepEqual(verification.offlineTests, { passed: 45, failed: 0 });
  addJson('verification/offline-tests.json', verification);
  for (const file of ['credential-audit.json', 'v3-integrity-check.json']) {
    addJson(`verification/${file}`, readJson(file, `verification/${file}`));
  }
  const expectedV3 = aggregate.rows.filter(row => row.protocol === 'research-v3-aligned-contract-routing');
  assert.equal(expectedV3.length, 82);
  const generatedAt = new Date().toISOString();
  addJson('archive-manifest.json', {
    schemaVersion: 1, archivedAt: generatedAt, experimentDate: '2026-09-13', sampleCount: 106,
    v3SampleCount: expectedV3.length, batches: counts,
    scope: 'First-round research-component evidence; includes historical protocols, availability probes, errors and timeouts.',
    sourceSelection: 'aggregate-final/all-results.json; every selected row checked against its original run/sample JSON',
    originalRows: 'runs/<run>/<sample>.json', aggregateRows: 'all-results.json',
    redactions: ['Authorization and credential fields are omitted.', 'Known credential values are redacted without being logged.',
      'Local absolute paths become relative archive references or [local-path].', 'Request messages are omitted; request configuration and raw response messages are retained.'],
    evidenceBoundary: ['Source hashes identify pre-redaction source bytes.', 'This export does not call providers or rerun the recorded 45 tests.',
      'The aggregate result projection is separate from each original sample result.',
      'Model/source hashes identify the executed version; later runner hardening was offline and does not change these live samples.']
  });

  const protocolTable = counts.map(item => `| ${item.run} | ${item.protocol} | ${item.concurrency} | ${item.samples} |`).join('\n');
  addText('README.md', `# 2026-09-13 首轮活动研究评测证据归档\n\n` +
    `本目录保存 10 个真实运行批次的 **106 条样本**，其中 **82 条属于 v3 协议**。包含可用性探测、失败、超时和旧协议；没有挑选成功结果。无需本机忽略目录即可阅读。\n\n` +
    `- [协议分组报告](report.md)：运行、费用和结构诊断，不是人工质量总分。\n` +
    `- [全部紧凑结果](all-results.json)：106 条记录及配置；逐个原始样本位于 runs/<run>/<sample>.json。\n` +
    `- [盲评材料](blind-review.json)与[人工评分规则](inputs/rubric.md)：保留来源、未验证状态和逐项限制。\n` +
    `- [归一化消融](normalization-results.json)：复用已完成的离线分析，原始失败与归一化后结果并存。\n` +
    `- [架构指标](architecture-metrics.json)、[预算账本](receipts/budget-ledger.json)及 receipts/ 下的脱敏核对回执。\n` +
    `- [45 项离线测试记录](verification/offline-tests.json)、[v3 完整性检查](verification/v3-integrity-check.json)与[归档审计](verification/archive-audit.json)。\n` +
    `- [来源及导出文件 SHA-256 索引](sha256-index.json)、[归档说明](archive-manifest.json)、[用例](inputs/cases.json)和[模型目录](inputs/models.json)。\n\n` +
    `| 批次 | 协议 | 并发 | 实际样本 |\n| --- | --- | ---: | ---: |\n${protocolTable}\n\n` +
    `## 保存内容\n\n` +
    `原始样本保留用户可见输出、引用、usage、finish reason、provider、错误与执行时间；当前组件还保留原始 research artifact 和搜索/合成时序。请求只保留模型、推理、联网工具和输出合同等配置，省略重复提示词及消息。未复制鉴权头、环境配置、后端源码树或依赖目录。baseline-manifest.json 仅保存源代码和依赖锁文件的哈希。\n\n` +
    `原始 run/sample 的 result 保留当时快照；all-results.json 和盲评材料复用已完成的评审投影，所以旧样本投影中的状态问题不会被静默回写。归一化来自既有 aggregate-final 输出，离线耗时也按原分析保留，没有追加模型调用。\n\n` +
    `## 来源与限制\n\n` +
    `归档选择以最终聚合清单为准，并逐项与实际 run/sample 文件核对。sourceId 是原始证据标识，archivedAs 是本目录内文件；本机绝对路径已替换。索引同时给出脱敏前源文件和脱敏后归档文件的哈希，二者不要求相同；索引不对自身计算哈希。原始忽略目录未修改。\n\n` +
    `这是一轮活动候选研究实验，不能证明完整 Planner、持久化、保存恢复或微信 UI 端到端完成。引用链接存在不代表事实真实。探测/旧协议/v3 按协议与并发分别统计；后续离线修复没有被冒充为新一轮付费实测。\n\n` +
    `账本含未知费用预留，provider 回执才是最终计费依据；SerpApi 次数与套餐价格独立保留。45 项测试记录是已有验证证据，本次导出只做读取、内容核对、脱敏与文件完整性检查，并未重新请求 API 或重跑这 45 项。\n`);

  // Audit entirely in memory before any archive file is written. No secret value
  // is printed; a failed audit emits only a categorical error.
  const hasCredential = text => credentialPattern.test(text) || knownSecrets.some(secret => text.includes(secret));
  const hasLocalPath = value => typeof value === 'string' ? absolutePathPattern.test(value)
    : Array.isArray(value) ? value.some(hasLocalPath)
      : value && typeof value === 'object' ? Object.entries(value).some(([key, item]) => hasLocalPath(key) || hasLocalPath(item)) : false;
  const secretHit = [...generated.values()].some(hasCredential);
  // Inspect decoded strings; JSON-escaped quotes are not UNC filesystem paths.
  const localPathFiles = [...generated].filter(([path, text]) => hasLocalPath(path.endsWith('.json') ? JSON.parse(text) : text)).map(([path]) => path);
  const localPathHit = localPathFiles.length > 0;
  if (secretHit) throw new Error('ARCHIVE_SECRET_SCAN_HIT');
  if (localPathHit) throw new Error(`ARCHIVE_LOCAL_PATH_SCAN_HIT: ${localPathFiles.join(',')}`);
  let sourceChanged = false;
  for (const entry of sourceEntries.values()) {
    const path = entry.sourceId.startsWith('experiment/')
      ? join(here, entry.sourceId.slice('experiment/'.length)) : join(runs, entry.sourceId);
    if (sha256(readFileSync(path)) !== entry.sha256) sourceChanged = true;
  }
  assert.equal(sourceChanged, false, 'source evidence changed while exporting');
  addJson('verification/archive-audit.json', {
    checkedAt: generatedAt, sampleCount: 106, uniqueSampleIds: sampleIds.size, v3SampleCount: 82,
    originalSampleCorrespondence: true, sourceFilesUnchanged: true,
    secretScanHit: false, localAbsolutePathHit: false, credentialFieldsRemoved: redactedFields,
    credentialValuesRedacted: redactedCredentialValue,
    secretScanScope: 'Known configured credential values, recognizable key/token patterns and credential field exclusion; no .env file access.',
    externalCalls: 0, recordedOfflineTests: { passed: 45, failed: 0 }, testsRerunDuringExport: false
  });
  addJson('sha256-index.json', {
    algorithm: 'sha256', sources: [...sourceEntries.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)),
    archiveFiles: [...generated].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => ({
      path, sha256: sha256(content), bytes: Buffer.byteLength(content)
    })), selfExcluded: 'sha256-index.json'
  });
  assert.ok([...generated.keys()].every(path => !path.startsWith('/') && !path.split('/').includes('..')));
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  for (const [path, content] of generated) {
    const destination = join(output, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content, { flag: 'wx' });
  }
  for (const [path, content] of generated) assert.equal(sha256(readFileSync(join(output, path))), sha256(content));
  return { archive: unix(relative(here, output)), samples: 106, v3Samples: 82, files: generated.size,
    bytes: [...generated.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0),
    secretScanHit: false, localAbsolutePathHit: false, sourceFilesUnchanged: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(exportResults()));
}
