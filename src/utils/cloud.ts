// src/utils/cloud.ts — wx.cloud 云函数调用封装
// 惰性初始化；调用失败（未初始化/未部署/网络）返回 null，由调用方降级本地直调
import Taro from '@tarojs/taro'

/** wx.cloud 最小类型声明（Taro 类型不含 wx 全局） */
declare const wx: {
  cloud?: {
    init: (opts?: { traceUser?: boolean }) => void
    callFunction: (opts: { name: string; data: Record<string, unknown> }) => Promise<{ result: unknown }>
  }
} | undefined

let inited = false

/** 仅小程序端可用 wx.cloud；初始化一次 */
function ensureInit(): boolean {
  if (process.env.TARO_ENV !== 'weapp') return false
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEAPP) return false
  if (typeof wx === 'undefined' || !wx.cloud) return false
  if (!inited) {
    wx.cloud.init({ traceUser: true })
    inited = true
  }
  return true
}

/**
 * 调用云函数；任何失败返回 null（调用方自行降级）
 * @param name 云函数名（如 routePlanner）
 * @param data 事件参数
 */
export async function callCloud<T = unknown>(name: string, data: Record<string, unknown>): Promise<T | null> {
  if (!ensureInit() || typeof wx === 'undefined' || !wx.cloud) return null
  try {
    const res = await wx.cloud.callFunction({ name, data })
    return res.result as T
  } catch {
    return null
  }
}
