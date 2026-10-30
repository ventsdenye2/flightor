import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { backend, dataRoot, dshHome, userDshHome, nodeBin, dshBin } from '../src/paths.mjs'
const env = { ...process.env, DSH_HOME: dshHome, FLIGHTOR_DSH_CREDENTIALS: path.join(userDshHome, '.credentials.yaml'), FLIGHTOR_DSH_PERSONA: 'FLIGHTOR_PERSONA_PROBE', FLIGHTOR_DSH_TOOLS_PLUGIN: path.join(backend, 'dsh/tools.mjs') }
const result = spawnSync(nodeBin, [dshBin, '--profile', 'flightor', '--patch', path.join(backend, 'dsh/flightor.patch.yml'), '--dump-config'], { env, encoding: 'utf8', windowsHide: true })
fs.mkdirSync(dataRoot, { recursive: true })
fs.writeFileSync(path.join(dataRoot, 'profile-dump.yml'), result.stdout)
console.log(result.stdout.split('\n').filter((row, index, all) => row.includes('flightor') || row.includes('personaPrefix') || row.includes('FLIGHTOR_') || row.includes('system-prompt') || row.includes('credentials')).join('\n'))
console.log(result.stderr.slice(-1500))
