const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildEnvironment, createBuildInfo, writeBuildInfo } = require('./weapp-build-info.cjs')

const root = path.resolve(__dirname, '..')
const apiBaseUrl = (process.env.FLIGHTOR_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const info = createBuildInfo(root, 'production', apiBaseUrl)
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@tarojs/cli/bin/taro'), 'build', '--type', 'weapp', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ...buildEnvironment(info) }
})

if (result.error) throw result.error
if (result.status === 0) writeBuildInfo(root, info)
process.exitCode = result.status ?? 1
