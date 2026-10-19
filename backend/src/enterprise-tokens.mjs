import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { backend } from './paths.mjs'
import { wikimediaHttp } from './wikimedia-http.mjs'

export function tokenMetadata(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString())
    return { use: payload.token_use, expiresAt: Number(payload.exp) * 1000 }
  } catch { return {} }
}

/** Credentials stay in the backend environment; auth responses never enter the HTTP cache. */
export class EnterpriseTokens {
  constructor({ env = process.env, file = path.join(backend, '.env'), http = wikimediaHttp, now = Date.now } = {}) {
    Object.assign(this, { env, file, http, now })
  }
  async getAccessToken({ forceRefresh = false } = {}) {
    const token = this.env.WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN?.trim()
    const metadata = tokenMetadata(token)
    if (token && metadata.use && metadata.use !== 'access') {
      if (!this.env.WIKIMEDIA_ENTERPRISE_REFRESH_TOKEN) throw Error('WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN 需要 access_token，不能使用 id_token')
    } else if (token && !forceRefresh && (!metadata.expiresAt || metadata.expiresAt > this.now() + 120000)) return token
    if (!this.env.WIKIMEDIA_ENTERPRISE_REFRESH_TOKEN || !this.env.WIKIMEDIA_ENTERPRISE_USERNAME) {
      if (token) throw Error('Enterprise access token 已过期，需要刷新配置')
      return undefined
    }
    if (this.pending) return this.pending
    this.pending = this.#refresh()
    try { return await this.pending } finally { this.pending = null }
  }
  async #refresh() {
    const value = await this.http.json('https://auth.enterprise.wikimedia.com/v1/token-refresh', {
      method: 'POST', cache: false, body: JSON.stringify({ username: this.env.WIKIMEDIA_ENTERPRISE_USERNAME.toLowerCase(), refresh_token: this.env.WIKIMEDIA_ENTERPRISE_REFRESH_TOKEN }) })
    if (!value.access_token || !value.id_token || tokenMetadata(value.access_token).use !== 'access') throw Error('Enterprise token refresh failed')
    const updates = {
      WIKIMEDIA_ENTERPRISE_USERNAME: this.env.WIKIMEDIA_ENTERPRISE_USERNAME,
      WIKIMEDIA_ENTERPRISE_ACCESS_TOKEN: value.access_token,
      WIKIMEDIA_ENTERPRISE_ID_TOKEN: value.id_token,
      WIKIMEDIA_ENTERPRISE_REFRESH_TOKEN: value.refresh_token || this.env.WIKIMEDIA_ENTERPRISE_REFRESH_TOKEN
    }
    Object.assign(this.env, updates)
    if (this.file) {
      let text = ''
      try { text = await fs.readFile(this.file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
      const keys = Object.keys(updates)
      const lines = text.split(/\r?\n/).filter(line => !keys.some(key => new RegExp('^\\s*' + key + '\\s*=').test(line)))
      const temporary = this.file + '.' + crypto.randomUUID() + '.tmp'
      await fs.writeFile(temporary, lines.filter((line, i) => line || i < lines.length - 1).join('\n') + '\n' + keys.map(key => `${key}=${updates[key]}`).join('\n') + '\n', { mode: 0o600 })
      await fs.rename(temporary, this.file)
    }
    return value.access_token
  }
}
export const enterpriseTokens = new EnterpriseTokens()
