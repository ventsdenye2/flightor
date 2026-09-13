const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const GIT_MAX_BUFFER = 128 * 1024 * 1024

function readGit(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    maxBuffer: GIT_MAX_BUFFER,
    ...options
  })
}

function readGitSha(root) {
  return readGit(root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
}

function splitNullTerminated(value) {
  return value.toString('utf8').split('\0').filter(Boolean)
}

function hashUntrackedFile(hash, root, relativePath) {
  const absolutePath = path.resolve(root, relativePath)
  const stat = fs.lstatSync(absolutePath)
  hash.update('untracked\0')
  hash.update(relativePath.replace(/\\/g, '/'))
  hash.update('\0')
  if (stat.isSymbolicLink()) {
    hash.update('symlink\0')
    hash.update(fs.readlinkSync(absolutePath))
  } else {
    hash.update('file\0')
    hash.update(fs.readFileSync(absolutePath))
  }
  hash.update('\0')
}

function readGitSourceState(root) {
  const gitSha = readGitSha(root)
  const status = readGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const diff = readGit(root, ['diff', '--binary', '--full-index', '--no-ext-diff', 'HEAD', '--'])
  const untrackedPaths = splitNullTerminated(
    readGit(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  ).sort()
  const hash = crypto.createHash('sha256')
  hash.update('flightor-source-fingerprint-v1\0')
  hash.update(gitSha)
  hash.update('\0tracked-diff\0')
  hash.update(diff)
  hash.update('\0')
  for (const relativePath of untrackedPaths) hashUntrackedFile(hash, root, relativePath)
  return {
    gitSha,
    dirty: status.length > 0,
    sourceFingerprint: hash.digest('hex')
  }
}

function createBuildInfo(root, mode, apiBaseUrl) {
  const source = readGitSourceState(root)
  return {
    gitSha: source.gitSha,
    dirty: source.dirty,
    sourceFingerprint: source.sourceFingerprint,
    builtAt: new Date().toISOString(),
    mode,
    apiBaseUrl
  }
}

function buildEnvironment(info) {
  return {
    FLIGHTOR_BUILD_SHA: info.gitSha,
    FLIGHTOR_BUILD_DIRTY: String(info.dirty),
    FLIGHTOR_BUILD_FINGERPRINT: info.sourceFingerprint,
    FLIGHTOR_BUILD_TIME: info.builtAt,
    FLIGHTOR_BUILD_MODE: info.mode
  }
}

function writeBuildInfo(root, info) {
  const target = path.join(root, 'dist/build-info.json')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(info, null, 2)}\n`, 'utf8')
}

module.exports = { buildEnvironment, createBuildInfo, readGitSourceState, writeBuildInfo }
