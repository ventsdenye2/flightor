// src/utils/request.ts — Taro.request 统一封装
// 支持 loading / 超时重试 2 次 / 错误 Toast / 429 冷却提示
import Taro from '@tarojs/taro'
import { t } from '../i18n'
import { assertAuthSession, authSnapshot, AuthSessionChangedError, invalidateAuthSession, refreshAuthSession } from './authSession'

/** 自建 API 地址；真机运行时应配置为已备案 HTTPS 域名。 */
export const BASE_URL = FLIGHTOR_API_BASE_URL.replace(/\/$/, '')

/** 显式构建开关；FLIGHTOR_USE_MOCK=false 时走自建后端。 */
export const USE_MOCK = FLIGHTOR_USE_MOCK

export class ApiRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'ApiRequestError' }
}

interface RequestOptions<D> {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: D
  showLoading?: boolean
  loadingText?: string
  retry?: number
  /** Additional request headers (for example an idempotency key). */
  header?: Record<string, string>
  /** 单次请求超时毫秒，默认 10000（实时报价矩阵搜索需放宽） */
  timeout?: number
  /** Login and refresh must never inherit or renew a previous identity. */
  auth?: 'session' | 'none'
}

export async function request<T, D = Record<string, unknown>>(options: RequestOptions<D>): Promise<T> {
  const { url, method = 'GET', data, showLoading = false, loadingText = '加载中…', retry = 2, timeout = 10000, header: extraHeaders, auth = 'session' } = options
  const session = authSnapshot()
  let refreshed = false
  let recoveryFailed = false

  if (showLoading) {
    Taro.showLoading({ title: loadingText, mask: true })
  }

  let lastError: unknown
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const send = async () => {
        if (auth === 'session') assertAuthSession(session.revision)
        const accessToken = auth === 'session' ? authSnapshot().accessToken : ''
        const response = await Taro.request<T>({
          url: BASE_URL + url,
          method,
          data: data as any,
          timeout,
          header: {
            'content-type': 'application/json',
            ...extraHeaders,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
          }
        })
        if (auth === 'session') assertAuthSession(session.revision)
        return response
      }
      let res = await send()
      if (res.statusCode === 401 && auth === 'session' && !refreshed) {
        refreshed = true
        try { await refreshAuthSession(session, async refreshToken => {
          const response = await Taro.request<{ accessToken?: string; refreshToken?: string }>({
            url: BASE_URL + '/v1/auth/refresh', method: 'POST', timeout: 15000,
            header: { 'content-type': 'application/json' }, data: { refresh_token: refreshToken }
          })
          if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new ApiRequestError(response.statusCode, 'AUTH_REFRESH_FAILED', 'Session renewal failed')
          }
          if (!response.data.accessToken || !response.data.refreshToken) {
            throw new ApiRequestError(401, 'INVALID_AUTH_RESPONSE', 'Session renewal returned invalid credentials')
          }
          return { accessToken: response.data.accessToken, refreshToken: response.data.refreshToken }
        }) } catch (error) { recoveryFailed = true; throw error }
        res = await send()
      }
      if (res.statusCode === 401 && auth === 'session') invalidateAuthSession(session.revision)
      if (showLoading) Taro.hideLoading()

      if (res.statusCode === 429) {
        Taro.showToast({ title: t('net.rate'), icon: 'none', duration: 2500 })
        throw new Error('RATE_LIMITED')
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return res.data
      }
      const body = res.data as { error?: { code?: unknown; message?: unknown } } | undefined
      const code = typeof body?.error?.code === 'string' ? body.error.code.slice(0, 100) : `HTTP_${res.statusCode}`
      const message = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 500) : `HTTP ${res.statusCode}`
      throw new ApiRequestError(res.statusCode, code, message)
    } catch (err) {
      lastError = err
      if (recoveryFailed) break
      if (err instanceof AuthSessionChangedError || (err as Error).message === 'AUTH_REQUIRED') break
      if ((err as Error).message === 'RATE_LIMITED') break
      if (err instanceof ApiRequestError && err.status < 500) break
      // 超时/网络错误自动重试
      if (attempt < retry) continue
    }
  }

  if (showLoading) Taro.hideLoading()
  if (!(lastError instanceof AuthSessionChangedError)) Taro.showToast({ title: t('net.error'), icon: 'none' })
  throw lastError
}
