// Trip Context chip formatter regression.
// Transpiles only the pure helper: no Taro, network, stores, or cloud state.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const helperPath = path.resolve(process.cwd(), 'src', 'components', 'plan', 'tripContextChips.ts')
const source = fs.readFileSync(helperPath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS },
  fileName: helperPath
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports, Intl, console }, { filename: helperPath })
const { formatTripContextChips } = module.exports

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✅ ${name}`)
  } else {
    failed += 1
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function location(name, iata) {
  return { id: `${name}-id`, type: 'city', name, countryCode: 'JP', ...(iata ? { iata } : {}) }
}

const complete = {
  version: 3,
  origin: location('北京', 'PEK'),
  departureWindow: { from: '2026-09-07', to: '2026-09-09', precision: 'exact' },
  returnWindow: { from: '2026-09-15', precision: 'approximate' },
  travelDays: 8,
  budget: { amount: 15000, currency: 'CNY', scope: 'trip' },
  destinations: {
    mode: 'mixed',
    required: [location('东京', 'TYO')],
    preferred: [location('大阪', 'KIX')],
    excluded: [location('京都')]
  },
  interests: ['food', 'culture', '独立书店'],
  readyForRouteGeneration: false
}

const zh = formatTripContextChips(complete, 'zh')
check('中文完整摘要映射所有已供字段', zh.map(item => item.label).join('|') === [
  '出发 · 北京 (PEK)',
  '日期 · 去 9月7日–9月9日 · 回 约9月15日',
  '时长 · 8天',
  '行程预算 · ¥15,000',
  '必去 · 东京 (TYO)',
  '偏好 · 大阪 (KIX)',
  '避开 · 京都',
  '兴趣 · 美食',
  '兴趣 · 文化',
  '兴趣 · 独立书店'
].join('|'), zh.map(item => item.label).join('|'))
check('中文 remove label is accessible and derived', zh[0].removeLabel === '移除出发 · 北京 (PEK)')

const en = formatTripContextChips(complete, 'en')
check('英文 formatter localizes known labels and dates', en[1].label === 'Dates · Depart Sep 7–Sep 9 · return ~Sep 15', en[1]?.label)
check('英文 unknown interest remains server supplied', en[en.length - 1].label === 'Interest · 独立书店')

const sparse = formatTripContextChips({
  version: 1,
  destinations: { mode: 'open', required: [], preferred: [], excluded: [] },
  interests: [],
  readyForRouteGeneration: false
}, 'en')
check('absent facts stay absent', sparse.length === 0, JSON.stringify(sparse))
check('missing summary is empty', formatTripContextChips(undefined, 'zh').length === 0)

const bounded = formatTripContextChips({
  ...complete,
  destinations: {
    ...complete.destinations,
    required: Array.from({ length: 12 }, (_, index) => location(`城市${index}`, `C${String(index).padStart(2, '0')}`))
  },
  interests: Array.from({ length: 12 }, (_, index) => `兴趣${index}`)
}, 'zh')
check('display output is bounded', bounded.filter(item => item.kind.startsWith('destination')).length === 6)
check('display interests are bounded', bounded.filter(item => item.kind === 'interest').length === 6)

console.log(`\nTrip Context chips：${passed}/${passed + failed} passed`)
if (failed > 0) process.exitCode = 1
