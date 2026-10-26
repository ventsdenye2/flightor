import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'

const waits = [10, 20, 40, 80]
const lock = new Int32Array(new SharedArrayBuffer(4))
const canRetry = (error, platform, attempt) => platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code) && attempt < waits.length

// Retry only the atomic replacement, never the write or business operation.
export async function replaceFile(source, target, { rename = fsp.rename, wait = delay, platform = process.platform } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, target); return }
    catch (error) { if (!canRetry(error, platform, attempt)) throw error; await wait(waits[attempt]) }
  }
}
export function replaceFileSync(source, target, { rename = fs.renameSync, wait = ms => Atomics.wait(lock, 0, 0, ms), platform = process.platform } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { rename(source, target); return }
    catch (error) { if (!canRetry(error, platform, attempt)) throw error; wait(waits[attempt]) }
  }
}
