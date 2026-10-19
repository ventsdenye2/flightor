const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/features/ui-experience/worldFlight.ts'), 'utf8')
const moduleValue = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, {
  exports: moduleValue.exports, module: moduleValue,
  require: () => require(path.join(root, 'src/assets/ui-experience/airport-coordinates.json'))
})
const { projectWorldPoint, worldFlightLegs, worldTrackLines, worldFlightPosition } = moduleValue.exports
assert.equal(projectWorldPoint([0, 0]).x, 50)
assert.equal(projectWorldPoint([0, 90]).y, 0)
assert.equal(worldFlightLegs([{ from: 'unknown', to: 'unknown' }]).length, 0)
assert.equal(worldFlightPosition([], .5), null)
const legs = worldFlightLegs([{ from: '上海', to: '多哈', fromCode: 'pvg', toCode: 'DOH' }, { from: '多哈', to: '里斯本', fromCode: 'DOH', toCode: 'LIS' }])
assert.equal(legs.length, 2)
const from = worldFlightPosition(legs, 0), to = worldFlightPosition(legs, 1)
assert.ok(Math.abs(from.x - legs[0].points[0].x) < .00001)
assert.ok(Math.abs(to.y - legs[1].points[48].y) < .00001)
for (let i = 0; i <= 100; i++) {
  const p = worldFlightPosition(legs, i / 100)
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.angle))
  assert.ok(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100)
}
const pacific = worldFlightLegs([{ from: '东京', to: '旧金山', fromCode: 'NRT', toCode: 'SFO' }])
assert.ok(worldTrackLines(pacific).length > 48, 'dateline must split paths at map edges')
assert.ok(worldTrackLines(pacific).every(line => line.width < 5), 'no line may cross the whole map')
assert.equal(worldFlightLegs([{ from: '上海', to: '上海', fromCode: 'PVG', toCode: 'PVG' }]).length, 0)
console.log('PASS world projection, real airport lookup, unknown routes, animation endpoints and dateline wrapping')
