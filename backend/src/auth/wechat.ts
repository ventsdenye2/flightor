import type { AppEnv } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import { fetchJson, withQuery } from '../lib/http.js'

interface WechatSessionResponse {
  openid?: string
  session_key?: string
  unionid?: string
  errcode?: number
  errmsg?: string
}

export async function codeToWechatOpenId(code: string, env: AppEnv): Promise<string> {
  if (!env.WX_APPID || !env.WX_SECRET) {
    throw new AppError('WECHAT_NOT_CONFIGURED', 'WX_APPID/WX_SECRET is not configured', 503)
  }
  const url = withQuery('https://api.weixin.qq.com', '/sns/jscode2session', {
    appid: env.WX_APPID,
    secret: env.WX_SECRET,
    js_code: code,
    grant_type: 'authorization_code'
  })
  const response = await fetchJson<WechatSessionResponse>(url, { method: 'GET' }, { provider: 'wechat', timeoutMs: 10_000 })
  if (!response.openid) {
    throw new AppError('WECHAT_LOGIN_FAILED', 'WeChat rejected the login code', 502, { errcode: response.errcode })
  }
  return response.openid
}
