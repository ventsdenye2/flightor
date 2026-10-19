import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { listPackage, statFile, extractFile } from '@electron/asar'

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const installed = process.env.DSH_DESKTOP_RESOURCES || path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness/resources')
const archive = path.join(installed, 'app.asar')
const destination = path.join(backend, '.dsh-runtime')
if (fs.existsSync(path.join(destination, 'manifest.json'))) {
  console.log('Using existing DSH snapshot: ' + fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'))
  process.exit(0)
}
fs.mkdirSync(destination, { recursive: true })
let files = 0
for (const entry of listPackage(archive)) {
  const name = entry.replaceAll('\\', '/').replace(/^\//, '')
  if (!name.startsWith('dsh/')) continue
  const archivePath = entry.slice(1)
  const stat = statFile(archive, archivePath)
  if ('files' in stat || 'link' in stat) continue
  const relative = name.slice(4)
  const target = path.resolve(destination, relative)
  if (!target.startsWith(destination + path.sep)) throw Error('Unsafe archive path')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (stat.unpacked) fs.copyFileSync(path.join(installed, 'app.asar.unpacked', name), target)
  else fs.writeFileSync(target, extractFile(archive, archivePath))
  files++
}
const pkg = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'))
const manifest = { version: pkg.version, source: archive, archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), copiedAt: new Date().toISOString(), files }
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify(manifest))
