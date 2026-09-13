const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildEnvironment, createBuildInfo, readGitSourceState } = require('./weapp-build-info.cjs')

const root = fs.mkdtempSync(path.join(path.resolve(__dirname, '..'), '.tmp-build-info-'))

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

try {
  git('init')
  git('config', 'user.email', 'build-info-test@flightor.invalid')
  git('config', 'user.name', 'FlightOR Build Info Test')
  git('config', 'core.autocrlf', 'false')
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n', 'utf8')
  fs.writeFileSync(path.join(root, 'source.txt'), 'baseline\n', 'utf8')
  git('add', '.gitignore', 'source.txt')
  git('commit', '-m', 'baseline')

  const clean = readGitSourceState(root)
  assert.equal(clean.dirty, false)
  assert.match(clean.sourceFingerprint, /^[a-f0-9]{64}$/)
  assert.equal(readGitSourceState(root).sourceFingerprint, clean.sourceFingerprint)

  fs.writeFileSync(path.join(root, 'source.txt'), 'changed\n', 'utf8')
  const trackedChange = readGitSourceState(root)
  assert.equal(trackedChange.dirty, true)
  assert.notEqual(trackedChange.sourceFingerprint, clean.sourceFingerprint)
  assert.equal(readGitSourceState(root).sourceFingerprint, trackedChange.sourceFingerprint)

  fs.writeFileSync(path.join(root, 'new-source.txt'), 'untracked\n', 'utf8')
  const untrackedChange = readGitSourceState(root)
  assert.notEqual(untrackedChange.sourceFingerprint, trackedChange.sourceFingerprint)

  fs.writeFileSync(path.join(root, 'ignored.txt'), 'local secret material\n', 'utf8')
  assert.equal(readGitSourceState(root).sourceFingerprint, untrackedChange.sourceFingerprint)

  const info = createBuildInfo(root, 'production', 'http://127.0.0.1:3000')
  const environment = buildEnvironment(info)
  assert.equal(environment.FLIGHTOR_BUILD_DIRTY, 'true')
  assert.equal(environment.FLIGHTOR_BUILD_FINGERPRINT, info.sourceFingerprint)
  assert.equal(Object.values(info).includes('local secret material'), false)
  console.log('weapp build info: 11 passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
