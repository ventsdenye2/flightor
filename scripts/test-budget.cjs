// scripts/test-budget.cjs — 前端 Mock 预算解析纯函数回归
// 只转译并执行无依赖 parser，不加载 Taro、网络或任何第三方密钥。
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const sourcePath = path.resolve(process.cwd(), 'src', 'services', 'budgetParser.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2017,
    module: ts.ModuleKind.CommonJS
  },
  fileName: sourcePath
}).outputText
const parserModule = { exports: {} }
vm.runInNewContext(compiled, { module: parserModule, exports: parserModule.exports }, { filename: sourcePath })

const { parseBudget } = parserModule.exports
const cases = [
  ['一万五', 15_000],
  ['一万五千', 15_000],
  ['两万三', 23_000],
  ['1万5', 15_000],
  ['1万5千', 15_000],
  ['1.5万', 15_000],
  ['八千', 8_000],
  ['一万零五百', 10_500],
  ['15000', 15_000],
  ['改成一万五', 15_000],
  ['一万零', null],
  ['一万多', null]
]

let passed = 0
let failed = 0
for (const [text, expected] of cases) {
  const actual = parseBudget(`预算${text}`)
  if (actual === expected) {
    passed++
    console.log(`  ✅ ${text} => ${expected}`)
  } else {
    failed++
    console.log(`  ❌ ${text} => ${actual}（expected ${expected}）`)
  }
}

console.log(`\n预算解析回归：${passed}/${cases.length} passed`)
if (failed > 0) process.exitCode = 1
