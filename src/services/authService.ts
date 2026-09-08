// src/services/authService.ts — 登录服务
// Mock 模式：本地游客登录（稳定 uid，离线可用）；真实模式：Taro.login 拿 code → cloud/login 换 openid
import Taro from '@tarojs/taro'
import { request, USE_MOCK } from '../utils/request'
import { assertAuthSession, beginAuthSession, clearAuthSession, commitAuthTokens } from '../utils/authSession'

export interface UserProfile {
  uid: string
  nickname: string
  avatarUrl: string
}

/** Remove bearer credentials without touching unrelated product storage. */
export function clearAuthTokens(): void {
  clearAuthSession()
}

interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: {
    id: string
    nickname: string
    avatarUrl: string
  }
}

/** 微信登录：换取用户档案（含服务端建档）。资料同步不得轮换本地登录凭据。 */
export async function wxLogin(
  profile?: { nickname?: string; avatarUrl?: string },
  options: { persistTokens?: boolean } = {}
): Promise<UserProfile> {
  const revision = options.persistTokens !== false ? beginAuthSession() : undefined
  if (USE_MOCK) {
    // 游客模式：本地生成稳定 uid，模拟 300ms 网络延迟
    await new Promise(r => setTimeout(r, 300))
    if (revision !== undefined) assertAuthSession(revision)
    let uid = Taro.getStorageSync('mock_uid') as string
    if (!uid) {
      uid = `guest-${Date.now().toString(36)}`
      Taro.setStorageSync('mock_uid', uid)
    }
    return {
      uid,
      nickname: profile?.nickname || '',
      avatarUrl: profile?.avatarUrl || ''
    }
  }

  const { code } = await Taro.login()
  if (revision !== undefined) assertAuthSession(revision)
  const res = await request<LoginResponse>({
    url: '/v1/auth/wechat',
    method: 'POST',
    data: {
      code,
      nickname: profile?.nickname || '',
      avatar_url: profile?.avatarUrl || ''
    },
    showLoading: true,
    retry: 0,
    auth: 'none',
    timeout: 15000
  })
  if (!res.user?.id || typeof res.accessToken !== 'string' || !res.accessToken || typeof res.refreshToken !== 'string' || !res.refreshToken) {
    throw new Error('INVALID_LOGIN_RESPONSE')
  }
  if (options.persistTokens !== false) {
    commitAuthTokens(res, revision!)
  }
  return { uid: res.user.id, nickname: res.user.nickname, avatarUrl: res.user.avatarUrl }
}

/** 头像临时文件转持久路径（chooseAvatar 返回的 tmp 路径会过期） */
export async function persistAvatar(tempPath: string): Promise<string> {
  try {
    const fs = Taro.getFileSystemManager()
    const target = `${Taro.env.USER_DATA_PATH}/avatar.png`
    fs.copyFileSync(tempPath, target)
    return target
  } catch {
    return tempPath
  }
}
