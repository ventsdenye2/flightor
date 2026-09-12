/** Translate stable auth failure codes; never display raw provider responses. */
export function loginErrorKey(error: unknown): string {
  const value = error as { code?: string; message?: string } | null
  if (value?.code === 'WECHAT_NOT_CONFIGURED') return 'login.notConfigured'
  if (value?.code === 'WECHAT_LOGIN_FAILED') return 'login.wechatRejected'
  if (value?.code === 'LOCAL_LOGIN_DISABLED') return 'login.localDisabled'
  if (value?.code === 'LOCAL_LOGIN_REJECTED') return 'login.localRejected'
  if (value?.code === 'HTTP_429' || value?.message === 'RATE_LIMITED') return 'net.rate'
  return 'login.fail'
}
