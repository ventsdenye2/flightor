const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { parse } = require('../backend/node_modules/dotenv')

const root = path.resolve(__dirname, '..')
const config = parse(fs.readFileSync(path.join(root, 'backend/.env.demo'), 'utf8'))
if (config.NODE_ENV !== 'development' || config.LOCAL_LOGIN_ENABLED !== 'true'
  || config.HOST !== '127.0.0.1' || !config.LOCAL_LOGIN_KEY || config.LOCAL_LOGIN_KEY.length < 32) {
  throw new Error('Run npm --prefix backend run local-login:setup before building the local test client')
}
const port = Number(config.PORT || 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local API port')
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@tarojs/cli/bin/taro'), 'build', '--type', 'weapp', ...process.argv.slice(2)], {
  cwd: root, stdio: 'inherit',
  env: {
    ...process.env,
    FLIGHTOR_USE_MOCK: 'false',
    FLIGHTOR_API_BASE_URL: `http://127.0.0.1:${port}`,
    FLIGHTOR_LOCAL_LOGIN_KEY: config.LOCAL_LOGIN_KEY
  }
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
