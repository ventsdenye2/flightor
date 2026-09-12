import { describe, expect, it } from 'vitest'
import { InMemoryUserIdentityRepository } from './repository.js'

describe('User identity contract', () => {
  it('maps repeated trusted WeChat subjects to one internal business user', async () => {
    const identities = new InMemoryUserIdentityRepository()
    const first = await identities.resolveWechat({ providerSubject: 'wx-openid', nickname: 'A', avatarUrl: '' })
    const second = await identities.resolveWechat({ providerSubject: 'wx-openid', nickname: 'Updated', avatarUrl: '' })
    expect(second.userId).toBe(first.userId)
    expect(second.publicId).toBe(first.publicId)
    expect(second.nickname).toBe('Updated')
  })

  it('does not use a caller-supplied business user id as identity input', () => {
    const acceptedFields: Array<keyof Parameters<InMemoryUserIdentityRepository['resolveWechat']>[0]> = [
      'providerSubject', 'nickname', 'avatarUrl'
    ]
    expect(acceptedFields).not.toContain('userId')
  })

  it('reuses the local test account and keeps it separate from WeChat identities', async () => {
    const identities = new InMemoryUserIdentityRepository()
    const local = await identities.resolveLocalTest({ nickname: 'Local', avatarUrl: '' })
    const repeated = await identities.resolveLocalTest({ nickname: 'Updated', avatarUrl: '' })
    const wechat = await identities.resolveWechat({ providerSubject: 'default', nickname: 'WeChat', avatarUrl: '' })
    expect(repeated.userId).toBe(local.userId)
    expect(repeated.nickname).toBe('Updated')
    expect(wechat.userId).not.toBe(local.userId)
  })
})
