import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { backend, runtime, dshHome, userDshHome } from '../src/paths.mjs'

const sourceNode = process.env.FLIGHTOR_DSH_NODE || path.join(process.env.LOCALAPPDATA, 'Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe')
if (!fs.existsSync(path.join(runtime, 'node.exe'))) fs.copyFileSync(sourceNode, path.join(runtime, 'node.exe'))
const external = path.join(userDshHome, 'profiles/desktop/node_modules/@deepseek-ai/dsh-subagent-codex')
const copied = new Set()
function copyPackage(source) {
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'))
  const dest = path.join(runtime, 'node_modules', pkg.name)
  if (copied.has(pkg.name) || fs.existsSync(path.join(dest, 'package.json'))) return
  copied.add(pkg.name)
  fs.cpSync(source, dest, { recursive: true, dereference: true, filter: p => p === source || !path.relative(source, p).split(path.sep).includes('node_modules') })
  const resolveFrom = createRequire(path.join(source, 'package.json'))
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    if (fs.existsSync(path.join(runtime, 'node_modules', name, 'package.json'))) continue
    try {
      let entry
      try { entry = resolveFrom.resolve(name + '/package.json') } catch { entry = resolveFrom.resolve(name) }
      let folder = path.dirname(entry)
      while (!fs.existsSync(path.join(folder, 'package.json')) && folder !== path.dirname(folder)) folder = path.dirname(folder)
      copyPackage(folder)
    } catch (error) {
      if (!pkg.optionalDependencies?.[name]) throw error
    }
  }
}
if (fs.existsSync(external)) copyPackage(fs.realpathSync(external))
const profile = path.join(dshHome, 'profiles/flightor')
fs.mkdirSync(profile, { recursive: true })
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-experimental-auto-review', '@deepseek-ai/dsh-experimental-terminal-bundle']
if (fs.existsSync(path.join(runtime, 'node_modules/@deepseek-ai/dsh-subagent-codex/package.json'))) bundles.push('@deepseek-ai/dsh-subagent-codex')
fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'flightor-dsh-profile', private: true, dsh: { profile: { bundles } } }, null, 2))
fs.writeFileSync(path.join(profile, 'cordis.yml'), '[]\n')
fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]\n')
if (!fs.existsSync(path.join(profile, 'node_modules'))) fs.symlinkSync(path.join(runtime, 'node_modules'), path.join(profile, 'node_modules'), 'junction')
fs.writeFileSync(path.join(backend, 'dsh-inventory.json'), JSON.stringify({ runtime: JSON.parse(fs.readFileSync(path.join(runtime, 'manifest.json'))).version, bundles, externalPackages: [...copied], exclusions: ['Web/Electron UI', 'wallpaper', 'startup-screen', 'whale-widget'], note: 'Full base + SDK + non-UI desktop extensions; no tool allowlist or runtime extraction.' }, null, 2) + '\n')
console.log(JSON.stringify({ bundles, copiedExternalPackages: copied.size, isolatedHome: dshHome }))
