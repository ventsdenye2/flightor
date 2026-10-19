import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { dataRoot } from './paths.mjs'

const pending = new Map()
export async function cachedPlace(kind, identity, lookup, { root = dataRoot, now = Date.now, version = 3, signal, onCacheHit = () => {} } = {}) {
  const key = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  const directory = path.join(root, `${kind}-v${version}`), file = path.join(directory, key + '.json')
  try { const cached = JSON.parse(await fs.readFile(file, 'utf8')); if (cached.expiresAt > now()) { onCacheHit(); return cached.result } } catch {}
  if (!signal && pending.has(file)) return pending.get(file)
  const property = kind === 'place-locations' ? 'location' : 'media'
  const success = property === 'location' ? 'resolved' : 'ready'
  const task = (async () => {
    try {
      const value = await lookup(identity)
      signal?.throwIfAborted()
      const result = { [property]: value, status: value ? success : 'not-found' }
      try {
        await fs.mkdir(directory, { recursive: true })
        const temporary = file + '.' + crypto.randomUUID() + '.tmp'
        await fs.writeFile(temporary, JSON.stringify({ expiresAt: now() + (value ? (property === 'location' ? 30 : 7) * 86400000 : 900000), result }))
        await fs.rename(temporary, file)
      } catch { /* A cache write failure must not hide valid data. */ }
      return result
    } catch { return { [property]: null, status: 'unavailable' } }
  })()
  if (!signal) pending.set(file, task)
  try { return await task } finally { if (!signal) pending.delete(file) }
}
