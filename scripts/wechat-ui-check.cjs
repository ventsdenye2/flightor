'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const http = require('node:http')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const distRoot = path.join(repoRoot, 'dist', 'ui-experience')
const cliCandidates = [
  process.env.WECHAT_DEVTOOLS_CLI,
  'C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat',
  'C:\\Program Files\\Tencent\\微信web开发者工具\\cli.bat'
].filter(Boolean)
const cli = cliCandidates.find(candidate => fs.existsSync(candidate))
const required = ['project.config.json', 'app.json', 'app.wxss', 'pages/index/index.js', 'pages/index/index.wxml']
const openRequested = process.argv.includes('--open')
const projectAppIdRequested = process.argv.includes('--project-appid')
const repositoryProject = JSON.parse(fs.readFileSync(path.join(repoRoot, 'project.config.json'), 'utf8'))
let failed = false

function fail(message) {
  failed = true
  console.error(`[ui-experience] ERROR: ${message}`)
}
function ok(message) { console.log(`[ui-experience] OK: ${message}`) }

if (projectAppIdRequested && !openRequested) fail('--project-appid 只能与 --open 同用；未修改产物')

if (!fs.existsSync(distRoot)) {
  fail(`未找到 ${distRoot}，先运行 npm run build:ui-experience`)
} else {
  ok(`找到独立产物 ${distRoot}`)
  for (const relative of required) {
    if (fs.existsSync(path.join(distRoot, relative))) ok(`产物文件 ${relative}`)
    else fail(`缺少产物文件 ${relative}`)
  }
  try {
    const distConfigPath = path.join(distRoot, 'project.config.json')
    const project = JSON.parse(fs.readFileSync(distConfigPath, 'utf8'))
    if (projectAppIdRequested && openRequested && !failed) {
      if (!repositoryProject.appid) fail('仓库项目缺少 AppID，无法用于本地验收')
      else {
        project.appid = repositoryProject.appid
        fs.writeFileSync(distConfigPath, JSON.stringify(project, null, 2) + '\n')
        ok('仅独立 UI 产物采用仓库既有 AppID 进行本地调试；默认构建模板与仓库项目配置未修改')
      }
    }
    if (!project.miniprogramRoot) fail('project.config.json 缺少 miniprogramRoot')
    else ok(`miniprogramRoot=${project.miniprogramRoot}`)
    if (!project.appid) fail('project.config.json 缺少 appid')
    else if (project.appid === 'touristappid') console.warn('[ui-experience] WARN: appid=touristappid，仅用于本地验收，不可上传发布')
    else if (project.appid === repositoryProject.appid) ok('产物 AppID 与本仓库既有项目一致，仅用于本地 UI 验收')
    else fail('产物 AppID 既非游客也非本仓库既有项目；请重新构建独立 UI 产物')
  } catch (error) {
    fail(`无法读取 project.config.json：${error.message}`)
  }
}

if (cli) ok(`找到微信开发者工具 CLI：${cli}`)
else fail('未找到微信开发者工具 CLI；请安装官方微信开发者工具，或设置 WECHAT_DEVTOOLS_CLI')

// This IDE build derives its business data directory from temp/../, while its
// bundled CLI still assumes USERPROFILE/AppData/Local. Inspect both documented
// implementations' marker locations; never synthesize an enabled marker.
function enabledIDEProfile(cliPath) {
  const installRoot = path.dirname(cliPath)
  const packagePath = path.join(installRoot, 'resources', 'app.asar.unpacked', 'package.json')
  if (!fs.existsSync(packagePath)) return null // Older installations keep the CLI path.
  const appName = JSON.parse(fs.readFileSync(packagePath, 'utf8')).name
  if (typeof appName !== 'string' || !appName || /[\\/]/.test(appName)) throw new Error('IDE package.json 缺少有效应用名称')
  const installHash = crypto.createHash('md5').update(path.join(installRoot, 'resources', 'app.asar')).digest('hex')
  const standard = path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'Local', appName, 'User Data', installHash, 'Default')
  const electron = path.resolve(os.tmpdir(), '..', appName, 'User Data', installHash, 'Default')
  const candidates = [...new Set([standard, electron])]
  for (const profile of candidates) {
    const statusFile = path.join(profile, '.ide-status')
    const portFile = path.join(profile, '.ide')
    if (!fs.existsSync(statusFile) || !fs.existsSync(portFile)) continue
    if (fs.readFileSync(statusFile, 'utf8').trim() !== 'On') continue
    const portText = fs.readFileSync(portFile, 'utf8').trim()
    const port = Number(portText)
    if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) continue
    return { profile, port, useHTTP: profile !== standard }
  }
  throw new Error(`未找到启用的 IDE 服务标记（需 .ide-status=On 及有效 .ide 端口）。已检查：${candidates.join('；')}。请在当前运行的 IDE 安全设置核对服务端口。`)
}

function requestIDE(port, endpoint) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: endpoint, timeout: 30000 }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          if (response.statusCode !== 200) return reject(new Error(`本地 IDE HTTP ${response.statusCode}${typeof body.code === 'number' ? `，错误码 ${body.code}` : ''}：${typeof body.message === 'string' ? body.message.slice(0,300) : '请求未完成'}；未修改服务设置`))
          resolve(body)
        }
        catch { reject(new Error('本地 IDE 返回非 JSON 响应')) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('连接本地 IDE 超时')))
    request.on('error', reject)
  })
}

function checkNativeWXSS(cliPath) {
  const compiler = path.join(path.dirname(cliPath), 'resources', 'app.asar.unpacked', 'node_modules', 'wcc-exec', 'wcsc.exe')
  if (!fs.existsSync(compiler)) {
    console.warn('[ui-experience] WARN: 当前安装未提供 wcsc.exe，未执行官方 WXSS 编译检查')
    return
  }
  const sheets = ['app.wxss']
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(entryPath)
      else if (entry.name.endsWith('.wxss')) sheets.push(path.relative(distRoot, entryPath))
    }
  }
  const pagesRoot = path.join(distRoot, 'pages')
  if (fs.existsSync(pagesRoot)) visit(pagesRoot)
  const outputDirectory = fs.mkdtempSync(path.join(distRoot, '.wxss-check-'))
  try {
    for (let index = 0; index < sheets.length; index++) {
      const sheet = sheets[index]
      const output = path.join(outputDirectory, `${index}.out`)
      const result = spawnSync(compiler, ['-lc', '-o', output, sheet], {
        cwd: distRoot, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
      })
      const diagnostics = `${result.stdout || ''}\n${result.stderr || ''}`
      if (result.error || result.status !== 0 || /\bERR(?:OR)?\b/i.test(diagnostics)) {
        fail(`官方 WXSS 检查失败 ${sheet}：${result.error?.message || diagnostics.trim().slice(0, 1200) || `退出码 ${result.status}`}`)
      } else ok(`官方 WXSS 编译通过 ${sheet}`)
    }
  } finally {
    // Only remove the numbered files created in this check's own temp folder.
    for (let index = 0; index < sheets.length; index++) {
      const output = path.join(outputDirectory, `${index}.out`)
      if (fs.existsSync(output)) fs.unlinkSync(output)
    }
    fs.rmdirSync(outputDirectory)
  }
}

async function run() {
if (cli && !failed) checkNativeWXSS(cli)
if (openRequested) {
  if (!cli || failed) {
    fail('未执行 open：先修复上述环境/产物问题')
  } else {
    try {
      const active = process.platform === 'win32' ? enabledIDEProfile(cli) : null
      console.log('[ui-experience] 正在请求本地 IDE 打开项目（不会上传或发布）')
      if (active?.useHTTP) {
        ok(`使用已启用的 Electron IDE profile：${active.profile}；端口 ${active.port}`)
        const login = await requestIDE(active.port, '/v2/isLogin')
        if (login.login !== true) throw new Error('当前 IDE 尚未登录；未发起打开项目')
        const query = new URLSearchParams({ project: distRoot })
        await requestIDE(active.port, `/v2/open?${query}`)
        ok('IDE 已接受本地 open 请求；模拟器运行仍需单独验收')
      } else {
        const result = spawnSync(cli, ['open', '--project', distRoot, '--disable-gpu'], {
          cwd: repoRoot, shell: process.platform === 'win32', stdio: 'inherit'
        })
        if (result.error) fail(`CLI 启动失败：${result.error.message}`)
        else if (result.status !== 0) fail(`CLI open 返回 ${result.status}；请核对当前 IDE 服务端口状态`)
      }
    } catch (error) { fail(`未完成 IDE open：${error.message}`) }
  }
} else {
  console.log('[ui-experience] 仅做环境/产物检查；服务端口未探测。开启 IDE 服务端口后运行：node scripts/wechat-ui-check.cjs --open')
}

process.exitCode = failed ? 1 : 0
}
run().catch(error => { fail(error.message); process.exitCode = 1 })
