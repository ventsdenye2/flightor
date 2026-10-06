const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/app.config.ts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 }
}).outputText

function readConfig(target) {
  const sandbox = {
    exports: {},
    process: { env: { TARO_ENV: target } },
    defineAppConfig: config => config
  }
  vm.runInNewContext(compiled, sandbox, { filename: 'src/app.config.ts' })
  return sandbox.exports.default
}

const expected = [
  'pages/plan/index',
  'pages/explore/index',
  'pages/trips/index',
  'pages/profile/index'
]
const h5Paths = Array.from(readConfig('h5').tabBar.list, item => item.pagePath)
const weappPaths = Array.from(readConfig('weapp').tabBar.list, item => item.pagePath)

assert.deepEqual(h5Paths, expected.map(pagePath => `/${pagePath}`))
assert.deepEqual(weappPaths, expected)
console.log('tabBar path config: H5 canonical paths and Weapp paths preserved')
