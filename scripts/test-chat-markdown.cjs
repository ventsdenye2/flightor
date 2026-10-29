const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function load(name, native = false) {
  const suffix = native && name === 'MarkdownLink' ? '.weapp.tsx' : '.tsx'
  const file = path.resolve(__dirname, '../src/features/ui-experience', name + suffix)
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const mod = { exports: {} }
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: dependency => {
    if (dependency === './MarkdownLink') return load('MarkdownLink', native)
    if (dependency === '@tarojs/components') return {
      View: props => React.createElement('div', props),
      Text: ({ selectable, ...props }) => React.createElement('span', props),
      ScrollView: ({ scrollX, ...props }) => React.createElement('div', props),
    }
    return require(dependency)
  } }, { filename: file })
  return mod.exports
}
const { ChatMarkdown } = load('ChatMarkdown')
const render = content => renderToStaticMarkup(React.createElement(ChatMarkdown, { content }))
let passed = 0
function check(label, run) { run(); passed++; console.log('PASS ' + label) }

check('Chinese travel reply renders headings, emphasis, paragraphs and nested lists', () => {
  const html = render('## 东京建议\n\n推荐**浅草寺**和*上野公园*。\n保留换行。\n\n3. 上午出发\n   - 先吃早餐\n   - 再坐地铁\n4. 下午散步\n\n> 提前预约\n\n---\n\n~~旧安排~~')
  assert.match(html, /pl-md-h2/)
  assert.match(html, /pl-md-strong[^>]*>.*浅草寺/)
  assert.match(html, /pl-md-em/)
  assert.match(html, />3\.</)
  assert.match(html, />4\.</)
  assert.equal((html.match(/class="pl-md-list"/g) || []).length, 2)
  assert.match(html, /pl-md-quote/)
  assert.match(html, /pl-md-divider/)
  assert.match(html, /pl-md-del/)
  assert.ok(!html.includes('**'))
})
check('wide budget table preserves every cell, alignment and inline formatting', () => {
  const html = render('| 项目 | 金额 | 说明 |\n| :--- | ---: | :---: |\n| 住宿 | **1200** | 两晚 |\n| 餐饮 | 300 | 自理 |')
  assert.match(html, /pl-md-table-scroll/)
  assert.match(html, /min-width:420px/)
  assert.match(html, /text-align:right/)
  for (const text of ['项目', '金额', '说明', '住宿', '1200', '两晚', '餐饮', '300', '自理']) assert.ok(html.includes(text))
  assert.equal((html.match(/class="pl-md-table-cell"/g) || []).length, 9)
})
check('code stays literal while ordinary character references are decoded once', () => {
  const html = render('A &amp; B，`<tag>&amp;**literal**`\n\n```text\n<script>alert(1)</script>\n&amp; **原样**\n```')
  assert.match(html, /A &amp; B/)
  assert.match(html, /&lt;tag&gt;&amp;amp;\*\*literal\*\*/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&amp;amp; \*\*原样\*\*/)
  assert.ok(!html.includes('<script>'))
})
check('HTML, model images and unsafe URLs cannot become active content', () => {
  const html = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n![景点照片](https://example.com/tracker.png)\n\n[危险](javascript&#58;alert%281%29) [数据](data:text/html,test) [相对](/admin)')
  assert.ok(!/<(?:img|script|iframe)\b/.test(html))
  assert.ok(!html.includes('<a '))
  assert.ok(html.includes('景点照片'))
  assert.ok(html.includes('危险'))
  assert.ok(html.includes('&lt;img'))
})
check('safe links preserve destinations and use an accessible H5 anchor', () => {
  const html = render('[官网](https://example.com/?a=1&amp;b=2)')
  assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/)
  assert.match(html, /target="_blank" rel="noopener noreferrer"/)
})
check('native links invoke the existing source action with the real destination', () => {
  const { MarkdownLink } = load('MarkdownLink', true)
  const urls = []
  const element = MarkdownLink({ href: 'https://example.com', children: '官网', onOpenSource: url => urls.push(url) })
  element.props.onClick()
  assert.deepEqual(urls, ['https://example.com'])
})
check('task list markers are rendered once and remain read-only', () => {
  const html = render('- [x] 机票已确认\n- [ ] 预约博物馆')
  assert.equal((html.match(/☑/g) || []).length, 1)
  assert.equal((html.match(/☐/g) || []).length, 1)
  assert.ok(!html.includes('[x]'))
  assert.ok(!html.includes('type="checkbox"'))
})
check('plain and unfinished replies retain readable content', () => {
  for (const source of ['你好，想去哪里？', '**还未闭合', '```text\n未闭合代码', '- 还有一项\n\n后续说明']) {
    const html = render(source)
    assert.ok(html.length > 0)
    assert.ok(!html.includes('undefined'))
  }
})
console.log(`${passed} chat Markdown checks passed`)
