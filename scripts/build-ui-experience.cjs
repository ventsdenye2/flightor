'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const binName = process.platform === 'win32' ? 'taro.cmd' : 'taro'
const repoRoot = path.resolve(__dirname, '..')
const localBin = path.resolve(repoRoot, 'node_modules', '.bin', binName)
const sharedBin = path.resolve(repoRoot, '..', '..', 'node_modules', '.bin', binName)
const taroBin = fs.existsSync(localBin) ? localBin : sharedBin
const outputRoot = path.resolve(repoRoot, 'dist', 'ui-experience')
const projectTemplate = path.resolve(repoRoot, 'config', 'project.ui-experience.json')

function writeStandaloneProjectConfig() {
  const generatedPath = path.join(outputRoot, 'project.config.json')
  if (!fs.existsSync(generatedPath) || !fs.existsSync(projectTemplate)) return
  const generated = JSON.parse(fs.readFileSync(generatedPath, 'utf8'))
  const overrides = JSON.parse(fs.readFileSync(projectTemplate, 'utf8'))
  fs.writeFileSync(generatedPath, `${JSON.stringify({ ...generated, ...overrides }, null, 2)}\n`)
  console.log(`[ui-experience] wrote isolated project config (${overrides.appid})`)
}

const result = spawnSync(taroBin, ['build', '--type', 'weapp', ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: { ...process.env, FLIGHTOR_UI_EXPERIENCE: 'true' },
  shell: process.platform === 'win32',
  stdio: 'inherit'
})

if (result.error) throw result.error
if ((result.status ?? 1) === 0) writeStandaloneProjectConfig()
process.exit(result.status ?? 1)
