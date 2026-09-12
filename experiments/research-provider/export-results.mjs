import {readFileSync, writeFileSync, mkdirSync, readdirSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join, resolve, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const firstArchive = resolve(here, '../travel-research/results/2026-09-13');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const within = (root, path) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
};

// Archive only explicit offline receipts; never scan/copy env, backend source,
// dependency junctions or arbitrary files from the ignored run directories.
export function exportResults({providerRun = join(here, '.runs/candidate-replay-final'),
  backendRun = join(here, '.runs/backend-replay-smoke-01'),
  testLog = join(here, '.runs/all-offline-tests.tap'),
  output = join(here, 'results/2026-09-13')} = {}) {
  output = resolve(output);
  if (!within(join(here, 'results'), output)) throw new Error('EXPORT_OUTPUT_OUTSIDE_RESULTS');
  const provider = readJson(join(providerRun, 'provider-replay.json'));
  const backend = readJson(join(backendRun, 'backend-replay.json'));
  assert.equal(provider.rows.length, 32); assert.equal(backend.rows.length, 32);
  assert.equal(backend.valid, true);
  assert.equal(provider.manifest.networkAttempts, 0); assert.equal(backend.manifest.networkAttempts, 0);
  assert.equal(provider.manifest.newApiCostUsd, 0); assert.equal(backend.manifest.newApiCostUsd, 0);
  assert.equal(provider.manifest.baselineHash, backend.manifest.baselineHash);
  for (const manifest of [provider.manifest, backend.manifest]) for (const file of manifest.files) {
    assert.equal(hash(readFileSync(join(here, file.path))), file.sha256, `code changed: ${file.path}`);
  }
  const oldIndex = readJson(join(firstArchive, 'sha256-index.json'));
  for (const file of oldIndex.archiveFiles) assert.equal(hash(readFileSync(join(firstArchive, file.path))), file.sha256);
  for (const file of backend.manifest.sourceFiles) assert.equal(hash(readFileSync(join(firstArchive, file.path))), file.sha256);
  for (const row of provider.rows) {
    assert.equal(hash(readFileSync(resolve(here, row.sourceFile))), row.sourceSha256);
    assert.deepEqual(readJson(join(providerRun, row.sampleFile)), row);
    assert.deepEqual(readJson(join(providerRun, row.auditFile)), row.audit);
  }
  for (const row of backend.rows) {
    const {report, partialState, ...sample} = readJson(join(backendRun, row.sampleFile));
    assert.deepEqual(sample, row);
    assert.ok(report && !partialState && !row.error && row.integrityErrors.length === 0);
    assert.equal(row.auditFiles.length, 1);
    for (const file of row.auditFiles) assert.ok(readJson(join(backendRun, file)).raw);
  }
  const tap = readFileSync(testLog, 'utf8').replaceAll('\r\n', '\n');
  for (const [key, expected] of Object.entries({tests: 67, pass: 67, fail: 0, cancelled: 0, skipped: 0, todo: 0})) {
    assert.match(tap, new RegExp(`^# ${key} ${expected}$`, 'm'));
  }
  mkdirSync(dirname(output), {recursive: true}); mkdirSync(output);
  const files = [];
  function copyFile(source, path) {
    const bytes = readFileSync(source);
    mkdirSync(dirname(join(output, path)), {recursive: true});
    writeFileSync(join(output, path), bytes, {flag: 'wx'});
    files.push({path: path.replaceAll('\\', '/'), sha256: hash(bytes), bytes: bytes.length});
  }
  for (const [name, root, metadata] of [
    ['provider', providerRun, ['provider-replay.json', 'baseline-manifest.json']],
    ['backend', backendRun, ['backend-replay.json', 'manifest.json', 'baseline-manifest.json']],
  ]) {
    for (const path of metadata) copyFile(join(root, path), `${name}/${path}`);
    for (const folder of ['audits', 'samples']) {
      const paths = readdirSync(join(root, folder)).sort();
      assert.equal(paths.length, 32);
      for (const path of paths) {
        assert.match(path, folder === 'audits' ? /^thin_audit_[a-f0-9-]+\.json$/ : /^sample-\d{3}\.json$/);
        assert.ok(statSync(join(root, folder, path)).isFile());
        copyFile(join(root, folder, path), `${name}/${folder}/${path}`);
      }
    }
  }
  mkdirSync(join(output, 'verification'));
  writeFileSync(join(output, 'verification/all-offline-tests.tap'), tap, {flag: 'wx'});
  files.push({path: 'verification/all-offline-tests.tap', sha256: hash(tap), bytes: Buffer.byteLength(tap)});
  const forbidden = /sk-(?:or-v1-)?[a-zA-Z0-9_-]{20,}|Bearer\s+[a-zA-Z0-9_-]{20,}|(?:C:|D:)[\\/]+(?:Users|FunnyProject)[\\/]/;
  for (const file of files) assert.equal(forbidden.test(readFileSync(join(output, file.path), 'utf8')), false, `unexpected secret/path pattern: ${file.path}`);
  const audit = {generatedAt: new Date().toISOString(), firstRoundCommit: 'f3906e3ab785f46bbf48b68d1a4d23837b6cfac1',
    providerSamples: 32, backendSamples: 32, independentlyPersistedAudits: 64,
    firstArchiveFilesVerified: oldIndex.archiveFiles.length,
    baselineHash: backend.manifest.baselineHash, tests: {total: 67, passed: 67, failed: 0, skipped: 0},
    secretAndLocalPathPatternMatches: 0, newApiCostUsd: 0,
    policy: 'Exact copies of explicit offline run metadata, per-request audits and per-sample receipts. TAP line endings normalized to LF. No backend snapshot, environment, dependencies or first-round raw evidence is copied or modified.'};
  save(join(output, 'verification/archive-audit.json'), audit);
  const auditBytes = readFileSync(join(output, 'verification/archive-audit.json'));
  files.push({path: 'verification/archive-audit.json', sha256: hash(auditBytes), bytes: auditBytes.length});
  files.sort((a, b) => a.path.localeCompare(b.path));
  save(join(output, 'sha256-index.json'), {algorithm: 'sha256', selfExcluded: true, files});
  for (const file of files) assert.equal(hash(readFileSync(join(output, file.path))), file.sha256);
  const result = {output, files: files.length + 1, indexedFiles: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0), ...audit};
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Use exportResults(options) for alternative explicit run paths');
  exportResults();
}
