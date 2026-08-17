// src/utils/storage.ts — 本地缓存封装
import Taro from '@tarojs/taro'

const PREFIX = 'flightor:'

export function getStorage<T>(key: string, defaultValue: T): T {
  try {
    const v = Taro.getStorageSync(PREFIX + key)
    return v === '' || v === undefined || v === null ? defaultValue : (v as T)
  } catch {
    return defaultValue
  }
}

export function setStorage(key: string, value: unknown): void {
  try {
    Taro.setStorageSync(PREFIX + key, value)
  } catch {
    // 存储满/隐私模式静默失败
  }
}

export function removeStorage(key: string): void {
  try {
    Taro.removeStorageSync(PREFIX + key)
  } catch {
    // 忽略
  }
}
