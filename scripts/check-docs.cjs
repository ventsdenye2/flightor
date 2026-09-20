// Documentation hygiene only. Does not validate runtime claims or external URLs.
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const root = path.resolve(__dirname, '..')
const mode = process.argv[2] || ''
if (!['', '--staged'].includes(mode)) throw new Error('Usage: node scripts/check-docs.cjs [--staged]')
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const name = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(name) : [name]
})
const files = walk(path.join(root, 'docs')).filter(file => file.endsWith('.md'))
const errors = []
let checked = 0
for (const file of files) {
  // Code blocks may contain deliberate examples of nonexistent paths.
  const content = fs.readFileSync(file, 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '')
  for (const match of content.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    let target = match[1].replace(/^<|>$/g, '').split('#')[0]
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(target)) continue
    try { target = decodeURIComponent(target) } catch { errors.push(`${path.relative(root, file)}: invalid URL escape`); continue }
    checked++
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) errors.push(`${path.relative(root, file)}: missing ${target}`)
  }
}
const git = args => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\0').filter(Boolean)
const changes = mode === '--staged'
  ? git(['diff', '--cached', '--name-only', '-z'])
  : [...git(['diff', 'HEAD', '--name-only', '-z']), ...git(['ls-files', '--others', '--exclude-standard', '-z'])]
if (changes.some(name => !name.startsWith('docs/')) && !changes.some(name => name.startsWith('docs/'))) {
  errors.push('Changes outside docs require a corresponding docs update in the same batch.')
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else console.log(`docs: ${files.length} Markdown files, ${checked} relative links OK; change-batch docs check OK (${mode || 'working tree'}).`)
