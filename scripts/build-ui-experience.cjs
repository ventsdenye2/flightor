'use strict'

const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const binName = process.platform === 'win32' ? 'taro.cmd' : 'taro'
const repoRoot = path.resolve(__dirname, '..')
const localBin = path.resolve(repoRoot, 'node_modules', '.bin', binName)
const sharedBin = path.resolve(repoRoot, '..', '..', 'node_modules', '.bin', binName)
const taroBin = fs.existsSync(localBin) ? localBin : sharedBin
const result = spawnSync(taroBin, ['build', '--type', 'weapp', ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: { ...process.env, FLIGHTOR_UI_EXPERIENCE: 'true' },
  shell: process.platform === 'win32',
  stdio: 'inherit'
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
