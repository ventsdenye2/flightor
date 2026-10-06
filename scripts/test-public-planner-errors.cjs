const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const helperPath = path.resolve(__dirname, '../src/utils/publicPlannerError.ts')
const helperSource = fs.readFileSync(helperPath, 'utf8')
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText
const loaded = { exports: {} }
class ArtifactRequestSupersededError extends Error {}
vm.runInNewContext(compiled, {
  module: loaded,
  exports: loaded.exports,
  require(specifier) {
    assert.equal(specifier, '../services/artifactService')
    return { ArtifactRequestSupersededError }
  }
}, { filename: helperPath })
const { publicPlannerFailureStage, publicPlannerFailureMessage, publicPlannerRestoreError } = loaded.exports

const cases = [
  ['PROVIDER_TIMEOUT', 'provider'],
  ['MODEL_OUTPUT_LIMIT', 'output_limit'],
  ['PLACE_LOCATION_UNRESOLVED', 'location'],
  ['EVIDENCE_UNAVAILABLE', 'evidence'],
  ['PLANNER_CONTEXT_CHANGED', 'context_conflict'],
  ['PUBLICATION_CONTENT_CHANGED', 'context_conflict'],
  ['DSH_GUIDE_BASE_UNAVAILABLE', 'context_conflict'],
  ['DSH_CANDIDATE_REFERENCE_UNAVAILABLE', 'evidence'],
  ['RATE_LIMIT', 'provider'],
  ['DSH_COMMIT_CALL_LIMIT', 'commit'],
  ['DSH_GUIDE_NEEDS_REVISION', 'publication'],
  ['CONVERSATION_TURN_NOT_FOUND', 'ui_restore']
]
for (const [code, expected] of cases) {
  assert.equal(publicPlannerFailureStage(code), expected, code)
  assert.match(publicPlannerFailureMessage(code, 'en'), /\S/)
  assert.match(publicPlannerFailureMessage(code, 'zh'), /\S/)
}
assert.equal(publicPlannerFailureStage('SECRET_PROVIDER_BODY token=abc'), undefined)
assert.equal(publicPlannerFailureMessage('SECRET_PROVIDER_BODY token=abc', 'en'), undefined)
assert.ok(!publicPlannerFailureMessage('PROVIDER_TIMEOUT', 'en').includes('token=abc'))
const unknownFailure = new Error('HTTP body: bearer-secret stack=private')
assert.equal(publicPlannerRestoreError(unknownFailure, 'zh'), '本次请求状态暂时无法恢复。请重新打开行程并检查已保存结果，再决定是否重试。')
assert.equal(publicPlannerRestoreError(unknownFailure, 'en'), 'The request status could not be restored. Reopen the trip and check saved results before deciding whether to retry.')
assert.ok(!publicPlannerRestoreError(unknownFailure, 'en').includes('bearer-secret'))
assert.equal(publicPlannerRestoreError(new ArtifactRequestSupersededError(), 'en'), undefined)

const chatStore = fs.readFileSync(path.resolve(__dirname, '../src/stores/chatStore.ts'), 'utf8')
assert.match(chatStore, /publicPlannerFailureMessage\(code, locale\)/)
console.log(`Public planner error display checks: ${cases.length * 3 + 8} passed.`)
