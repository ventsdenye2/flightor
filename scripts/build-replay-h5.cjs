const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildEnvironment, createBuildInfo, writeBuildInfo } = require('./weapp-build-info.cjs')

const root = path.resolve(__dirname, '..')
const snapshotRoot = path.resolve(root, process.env.FLIGHTOR_REPLAY_SNAPSHOT || 'backend/.demo/flight-first-acceptance')
const manifest = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'manifest.json'), 'utf8'))
const snapshotText = fs.readFileSync(path.join(snapshotRoot, 'snapshot.json'), 'utf8')
const expectedHash = manifest.files?.find(file => file.path === 'snapshot.json')?.sha256
const actualHash = crypto.createHash('sha256').update(snapshotText).digest('hex')
if (!expectedHash || expectedHash !== actualHash) throw new Error('SNAPSHOT_HASH_MISMATCH')
if (manifest.replayPolicy?.strict !== true || manifest.replayPolicy?.liveFallback !== false) {
  throw new Error('Replay manifest must disable live fallback')
}

const port = Number(process.env.FLIGHTOR_REPLAY_PORT || 3012)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid replay API port')
const outputRoot = 'dist-h5-replay'
const apiBaseUrl = `http://127.0.0.1:${port}`
const info = {
  ...createBuildInfo(root, 'replay-h5', apiBaseUrl),
  snapshotCapturedAt: manifest.capturedAt,
  snapshotSha256: actualHash,
  strictReplay: true
}
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/@tarojs/cli/bin/taro'), 'build', '--type', 'h5'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...buildEnvironment(info),
    FLIGHTOR_OUTPUT_ROOT: outputRoot,
    FLIGHTOR_USE_MOCK: 'false',
    FLIGHTOR_API_BASE_URL: apiBaseUrl,
    FLIGHTOR_LOCAL_LOGIN_KEY: 'flightor-replay-loopback-client-key',
    FLIGHTOR_REPLAY_CAPTURED_AT: manifest.capturedAt
  }
})
if (result.error) throw result.error
if (result.status === 0) writeBuildInfo(root, info, outputRoot)
process.exitCode = result.status ?? 1
