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
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports }, { filename: helperPath })
const { publicPlannerFailureStage, publicPlannerFailureMessage } = loaded.exports

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

const chatStore = fs.readFileSync(path.resolve(__dirname, '../src/stores/chatStore.ts'), 'utf8')
assert.match(chatStore, /publicPlannerFailureMessage\(code, locale\)/)
console.log(`Public planner error display checks: ${cases.length * 3 + 4} passed.`)
