import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyResponse, assertCompatibleManifest} from './run-controls.mjs';

test('truncated or unfinished tool output retains execution status despite valid unlinked JSON', () => {
  const result = {valid: true, findings: [{citationLinked: false, unlinkedUrls: ['https://example.org']} ]};
  for (const finishReason of ['length', 'content_filter', 'tool_calls']) {
    assert.deepEqual(classifyResponse({finishReason, message: {}}, true, result),
      {status: 'incomplete', diagnostics: ['unlinked_evidence']});
  }
  assert.equal(classifyResponse({finishReason: 'stop', message: {tool_calls: [{}]}}, true, result).status, 'incomplete');
  assert.equal(classifyResponse({finishReason: 'stop', message: {}}, true, result).status, 'unlinked_evidence');
});

test('continuations reject changed model, search, request code or baseline while allowing filters', () => {
  const manifest = {casesHash: 'cases', modelsHash: 'models', baselineHash: 'backend',
    plan: {protocol: 'v4', engineMode: 'exa', concurrency: 2, arms: ['current-system']},
    runnerFiles: ['run.mjs', 'run-controls.mjs', 'openrouter.mjs', 'contracts.mjs', 'current-system.mjs']
      .map(path => ({path, sha256: path}))};
  assert.doesNotThrow(() => assertCompatibleManifest(manifest, {...manifest, plan: {...manifest.plan, cases: ['case-01']}}));
  for (const patch of [{modelsHash: 'other'}, {baselineHash: 'other'},
    {plan: {...manifest.plan, engineMode: 'native'}}, {plan: {...manifest.plan, concurrency: 1}},
    {runnerFiles: manifest.runnerFiles.map(file => file.path === 'contracts.mjs' ? {...file, sha256: 'changed'} : file)}]) {
    assert.throws(() => assertCompatibleManifest(manifest, {...manifest, ...patch}), /CONFIGURATION_MISMATCH/);
  }
  const thinOnly = {...manifest, baselineHash: null, plan: {...manifest.plan, arms: ['thin-web']}};
  assert.doesNotThrow(() => assertCompatibleManifest(thinOnly, manifest));
});
