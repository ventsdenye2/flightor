const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function inspectRuntimeSource(file, source) {
  const issues = []
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  function visit(node) {
    if (ts.isRegularExpressionLiteral(node) && /\(\?<[^=!]/.test(node.text)) {
      issues.push(`${file}: named regexp capture would require WeChat SWC runtime helpers`)
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('@swc/helpers/')) {
      issues.push(`${file}: external SWC helper is not bundled: ${node.arguments[0].text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return issues
}

function checkWeappRuntime(root = path.resolve(__dirname, '../dist/weapp')) {
  let checked = 0
  const issues = []
  function scan(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name)
      if (entry.isDirectory()) scan(file)
      else if (file.endsWith('.js')) { checked++; issues.push(...inspectRuntimeSource(file, fs.readFileSync(file, 'utf8'))) }
    }
  }
  scan(root)
  if (!checked) throw Error('No WeChat JavaScript output to inspect')
  if (issues.length) throw Error(issues.join('\n'))
  console.log(`weapp runtime: ${checked} JS files, no named regexp captures or external SWC helpers`)
}

module.exports = { inspectRuntimeSource, checkWeappRuntime }
if (require.main === module) checkWeappRuntime()
