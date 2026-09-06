export type IdentityProvider = 'wechat' | 'email' | 'google' | 'apple'

export interface ResolvedUserIdentity {
  userId: string
  publicId: string
  nickname: string
  avatarUrl: string
}

export interface UserIdentityRepository {
  resolveWechat(input: { providerSubject: string; nickname: string; avatarUrl: string }): Promise<ResolvedUserIdentity>
}

export class InMemoryUserIdentityRepository implements UserIdentityRepository {
  private readonly identities = new Map<string, ResolvedUserIdentity>()
  private nextUserId = 1

  async resolveWechat(input: { providerSubject: string; nickname: string; avatarUrl: string }): Promise<ResolvedUserIdentity> {
    const key = `wechat:${input.providerSubject}`
    const existing = this.identities.get(key)
    if (existing) {
      if (input.nickname) existing.nickname = input.nickname
      if (input.avatarUrl) existing.avatarUrl = input.avatarUrl
      return structuredClone(existing)
    }
    const created: ResolvedUserIdentity = {
      userId: String(this.nextUserId++),
      publicId: `00000000-0000-7000-8000-${String(this.nextUserId).padStart(12, '0')}`,
      nickname: input.nickname,
      avatarUrl: input.avatarUrl
    }
    this.identities.set(key, created)
    return structuredClone(created)
  }
}
