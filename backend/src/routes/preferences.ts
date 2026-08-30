import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { authenticateRequest } from '../auth/service.js'
import { AppError } from '../lib/errors.js'

const preferencesSchema = z.object({
  preferred: z.array(z.string().length(2)).max(50).default([]),
  excluded: z.array(z.string().length(2)).max(50).default([])
}).transform(input => ({
  preferred: [...new Set(input.preferred.map(code => code.toUpperCase()))],
  excluded: [...new Set(input.excluded.map(code => code.toUpperCase()))]
}))

export async function registerPreferenceRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.get('/v1/users/me/transit-country-preferences', async request => {
    const identity = await authenticateRequest(request, context)
    const rows = await context.db.selectFrom('transit_country_preferences')
      .select(['country_code', 'preference'])
      .where('user_id', '=', identity.userId)
      .execute()
    return {
      preferred: rows.filter(row => row.preference === 'preferred').map(row => row.country_code),
      excluded: rows.filter(row => row.preference === 'excluded').map(row => row.country_code)
    }
  })

  app.put('/v1/users/me/transit-country-preferences', async request => {
    const identity = await authenticateRequest(request, context)
    const input = preferencesSchema.parse(request.body)
    const overlap = input.preferred.filter(code => input.excluded.includes(code))
    if (overlap.length > 0) {
      throw new AppError('INVALID_PREFERENCES', 'A country cannot be preferred and excluded', 400, { countries: overlap })
    }
    const allCodes = [...input.preferred, ...input.excluded]
    if (allCodes.length > 0) {
      const existing = await context.db.selectFrom('countries').select('code').where('code', 'in', allCodes).execute()
      const known = new Set(existing.map(row => row.code))
      const unknown = allCodes.filter(code => !known.has(code))
      if (unknown.length > 0) throw new AppError('UNKNOWN_COUNTRY', 'One or more country codes are unknown', 400, { countries: unknown })
    }

    await context.db.transaction().execute(async trx => {
      await trx.deleteFrom('transit_country_preferences').where('user_id', '=', identity.userId).execute()
      const rows = [
        ...input.preferred.map(country_code => ({ user_id: identity.userId, country_code, preference: 'preferred' as const })),
        ...input.excluded.map(country_code => ({ user_id: identity.userId, country_code, preference: 'excluded' as const }))
      ]
      if (rows.length > 0) await trx.insertInto('transit_country_preferences').values(rows).execute()
    })
    return input
  })
}
