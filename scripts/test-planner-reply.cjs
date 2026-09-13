const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const file = path.resolve(__dirname, '../src/components/plan/PlannerReply.tsx')
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText
const loaded = { exports: {} }
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, require: dependency => {
  if (dependency === '@tarojs/components') return { Text: 'Text', View: 'View' }
  if (dependency === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  if (dependency.endsWith('.scss')) return {}
  throw new Error(`Unexpected renderer dependency: ${dependency}`)
} }, { filename: file })
const render = content => loaded.exports.default({ content })
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)]
const text = value => value === undefined || value === null || typeof value === 'boolean' ? '' : typeof value !== 'object' ? String(value) : Array.isArray(value) ? value.map(text).join('') : text(value.props?.children)
const byClass = (tree, name) => nodes(tree).filter(node => node.props.className?.split(' ').includes(name))
let passed = 0
function check(label, fn) { fn(); passed += 1; console.log(`PASS ${label}`) }

check('travel reply becomes separate paragraphs, day heading and readable list rows', () => {
  const tree = render('两天攻略已保存。\r\n预算：1500元人民币。\r\n\r\n## 第1天 10/12\r\n- **浅草寺**：免费进入。\r\n- 当地小吃：人形烧。\r\n\r\n营业时间需复核。')
  assert.equal(byClass(tree, 'planner-reply__paragraph').length, 2)
  assert.equal(text(byClass(tree, 'planner-reply__paragraph')[0]), '两天攻略已保存。\n预算：1500元人民币。')
  assert.equal(text(byClass(tree, 'planner-reply__heading')[0]), '第1天 10/12')
  assert.equal(byClass(tree, 'planner-reply__list').length, 2)
  assert.equal(text(byClass(tree, 'planner-reply__strong')[0]), '浅草寺')
  assert.ok(!text(tree).includes('**'))
  assert.ok(text(tree).includes('营业时间需复核。'))
})

check('ordered items keep their original numbering and indented bullets remain distinct', () => {
  const tree = render('3. 上野公园\n4) 阿美横街\n  - 散步\n    + 小吃')
  assert.deepEqual(byClass(tree, 'planner-reply__marker').map(text), ['3.', '4)', '•', '•'])
  assert.equal(byClass(tree, 'planner-reply__list--depth-1').length, 1)
  assert.equal(byClass(tree, 'planner-reply__list--depth-2').length, 1)
})

check('source HTML and URLs stay literal Text with no executable component or property', () => {
  const source = '<img src=x onerror="alert(1)">\n[来源](javascript:alert(1))\nhttps://example.com/source?q=东京'
  const tree = render(source)
  assert.equal(text(tree), source)
  for (const node of nodes(tree)) {
    assert.ok(['Text', 'View'].includes(node.type))
    assert.equal(node.props.dangerouslySetInnerHTML, undefined)
    assert.equal(node.props.onClick, undefined)
    assert.equal(node.props.src, undefined)
  }
})

check('fenced and inline code preserve literal Markdown and HTML', () => {
  const tree = render('指南 ID：`guide-1`\n\n```text\n**保持原样**\n- <script>test</script>\n```')
  assert.equal(text(byClass(tree, 'planner-reply__inline-code')[0]), 'guide-1')
  assert.equal(text(byClass(tree, 'planner-reply__code-text')[0]), '**保持原样**\n- <script>test</script>')
  assert.equal(byClass(tree, 'planner-reply__list').length, 0)
  assert.equal(byClass(tree, 'planner-reply__strong').length, 0)
})

check('unfinished markup and a plain-language reply are retained without truncation', () => {
  assert.equal(text(render('未完成的 **粗体')), '未完成的 **粗体')
  assert.equal(text(render('```text\n# 仍是文字\n- 未闭合代码')), '```text\n# 仍是文字\n- 未闭合代码')
  assert.equal(text(render('想从哪里出发？')), '想从哪里出发？')
  assert.equal(text(render('')), '')
})

check('line breaks remain in selectable native text and text never contains View children', () => {
  const tree = render('第一行\n第二行\n\n- **重点**和 `标识`')
  assert.equal(text(byClass(tree, 'planner-reply__paragraph')[0]), '第一行\n第二行')
  for (const node of nodes(tree).filter(value => value.type === 'Text')) {
    assert.ok(nodes(node.props.children).every(child => child.type === 'Text'))
  }
  assert.equal(byClass(tree, 'planner-reply__paragraph')[0].props.selectable, true)
})
console.log(`Planner reply behavior checks: ${passed} passed.`)
