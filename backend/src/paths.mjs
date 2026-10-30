import path from 'node:path'
import { fileURLToPath } from 'node:url'
export const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const repo = path.dirname(backend)
export const runtime = path.join(backend, '.dsh-runtime')
export const dshHome = path.join(backend, '.dsh-home')
export const dataRoot = path.join(backend, 'data')
export const userDshHome = process.env.FLIGHTOR_DSH_USER_HOME || path.join(process.env.USERPROFILE, '.dsh')
export const nodeBin = path.join(runtime, process.platform === 'win32' ? 'node.exe' : 'node')
export const dshBin = path.join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
