import type { Kysely } from 'kysely'
import { v7 as uuidv7 } from 'uuid'
import type { Database } from '../db/types.js'
import { AppError } from '../lib/errors.js'
import type { ResolvedUserIdentity, UserIdentityRepository } from './repository.js'

export class PostgresUserIdentityRepository implements UserIdentityRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async resolveWechat(input: { providerSubject: string; nickname: string; avatarUrl: string }): Promise<ResolvedUserIdentity> {
    const now = new Date()
    return this.db.transaction().execute(async trx => {
      // wechat_openid remains a compatibility/race anchor until a later
      // migration makes every login provider-neutral.
      const user = await trx.insertInto('users').values({
        public_id: uuidv7(),
        wechat_openid: input.providerSubject,
        nickname: input.nickname,
        avatar_url: input.avatarUrl,
        last_login_at: now
      }).onConflict(oc => oc.column('wechat_openid').doUpdateSet(eb => ({
        nickname: input.nickname || eb.ref('users.nickname'),
        avatar_url: input.avatarUrl || eb.ref('users.avatar_url'),
        last_login_at: now,
        updated_at: now
      }))).returning(['id', 'public_id', 'nickname', 'avatar_url']).executeTakeFirstOrThrow()

      const identity = await trx.insertInto('user_identities').values({
        user_id: user.id,
        provider: 'wechat',
        provider_subject: input.providerSubject,
        last_seen_at: now
      }).onConflict(oc => oc.columns(['provider', 'provider_subject']).doUpdateSet({
        last_seen_at: now
      })).returning('user_id').executeTakeFirstOrThrow()
      if (identity.user_id !== user.id) {
        throw new AppError('IDENTITY_CONFLICT', 'The provider identity is already linked to another user', 409)
      }
      await trx.insertInto('user_memories').values({ user_id: user.id })
        .onConflict(oc => oc.column('user_id').doNothing()).execute()
      return {
        userId: user.id,
        publicId: user.public_id,
        nickname: user.nickname,
        avatarUrl: user.avatar_url
      }
    })
  }
}
