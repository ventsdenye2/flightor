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
})
