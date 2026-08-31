// src/utils/request.ts — Taro.request 统一封装
// 支持 loading / 超时重试 2 次 / 错误 Toast / 429 冷却提示
import Taro from '@tarojs/taro'
import { t } from '../i18n'

/** 自建 API 地址；真机运行时应配置为已备案 HTTPS 域名。 */
export const BASE_URL = FLIGHTOR_API_BASE_URL.replace(/\/$/, '')

/** 显式构建开关；FLIGHTOR_USE_MOCK=false 时走自建后端。 */
export const USE_MOCK = FLIGHTOR_USE_MOCK

interface RequestOptions<D> {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: D
  showLoading?: boolean
  loadingText?: string
  retry?: number
  /** 单次请求超时毫秒，默认 10000（实时报价矩阵搜索需放宽） */
  timeout?: number
}

export async function request<T, D = Record<string, unknown>>(options: RequestOptions<D>): Promise<T> {
  const { url, method = 'GET', data, showLoading = false, loadingText = '加载中…', retry = 2, timeout = 10000 } = options

  if (showLoading) {
    Taro.showLoading({ title: loadingText, mask: true })
  }

  let lastError: unknown
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const accessToken = Taro.getStorageSync('access_token') as string
      const res = await Taro.request<T>({
        url: BASE_URL + url,
        method,
        data: data as any,
        timeout,
        header: {
          'content-type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        }
      })
      if (showLoading) Taro.hideLoading()

      if (res.statusCode === 429) {
        Taro.showToast({ title: t('net.rate'), icon: 'none', duration: 2500 })
        throw new Error('RATE_LIMITED')
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return res.data
      }
      throw new Error(`HTTP ${res.statusCode}`)
    } catch (err) {
      lastError = err
      if ((err as Error).message === 'RATE_LIMITED') break
      // 超时/网络错误自动重试
      if (attempt < retry) continue
    }
  }

  if (showLoading) Taro.hideLoading()
  Taro.showToast({ title: t('net.error'), icon: 'none' })
  throw lastError
}
