const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const babel = require('@babel/core')
const { Lexer } = require('marked')
const { inspectRuntimeSource } = require('./check-weapp-runtime.cjs')

// This is the actual dependency source that reaches WeChat's secondary compiler.
const source = fs.readFileSync(require.resolve('marked'), 'utf8')
assert.equal(inspectRuntimeSource('original-marked.js', source).length, 2)
const transformed = babel.transformSync(source, {
  babelrc: false, configFile: false,
  plugins: [[require.resolve('@babel/plugin-transform-named-capturing-groups-regex'), { runtime: false }]],
}).code
assert.deepEqual(inspectRuntimeSource('transformed-marked.js', transformed), [])
assert.ok(!transformed.includes('_wrapRegExp'))
assert.ok(!transformed.includes('.groups'))
const compiled = ts.transpileModule(transformed, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const mod = { exports: {} }
vm.runInNewContext(compiled, { module: mod, exports: mod.exports }, { filename: 'transformed-marked.cjs' })
const nativeLexer = mod.exports.Lexer
const fixtures = [
  '# 东京建议\n\n**浅草寺**和*上野公园*\n\n- 上午散步\n  - 河边休息',
  '[`a`](https://example.com) and `b`',
  '[outer `a [b]` rest](https://example.com/(x))',
  '`[not a link](https://example.com)`',
  '``x ` y`` and [title](https://example.com)',
  '![alt `x`](https://example.com/a.png)',
  '[`multi` and ``back`tick``](https://example.com/(nested))',
  '```text\n[not a link](https://example.com)\n```',
  '| 项目 | 金额 |\n| --- | ---: |\n| 住宿 | **1200** |',
  '- [x] 已预约\n- [ ] 待确认\n\n> **提前出发**',
  '<script>alert(1)</script>\n\n[危险](javascript:alert%281%29)',
  '**未闭合\n\n```text\n未闭合代码',
]
for (const content of fixtures) {
  assert.equal(JSON.stringify(nativeLexer.lex(content, { gfm: true, breaks: true })), JSON.stringify(Lexer.lex(content, { gfm: true, breaks: true })), content)
}
assert.equal(inspectRuntimeSource('regression.js', 'const r = /(?<a>`+)[^`]+\\k<a>(?!`)/;').length, 1)
assert.equal(inspectRuntimeSource('regression.js', "require('@swc/helpers/_/_wrap_reg_exp')").length, 1)
assert.deepEqual(inspectRuntimeSource('lookbehind.js', 'const r = /(?<=x)y|(?<!x)z/;'), [])
console.log(`PASS original failing syntax is detected; transformed Marked matches all ${fixtures.length} Markdown fixtures without runtime helpers`)
