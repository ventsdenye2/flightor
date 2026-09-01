import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { runAgentTurn, type AgentAirport, type AgentSlots, type AgentTurnInput } from '../agent/chat.js'
import { AppError } from '../lib/errors.js'

const slotsSchema = z.object({
  origin: z.string().trim().max(3).optional(),
  destination: z.string().trim().max(3).optional(),
  depart_date_from: z.string().trim().max(10).optional(),
  depart_date_to: z.string().trim().max(10).optional(),
  stay_min: z.number().int().min(1).max(60).optional(),
  stay_max: z.number().int().min(1).max(60).optional(),
  trip_type: z.enum(['oneway', 'roundtrip']).optional(),
  budget_max: z.number().min(100).max(10_000_000).optional(),
  interests: z.array(z.enum(['food', 'culture', 'nature', 'shopping', 'nightlife'])).max(5).optional(),
  transfer_pref: z.enum(['any', 'direct', 'transfer']).optional()
}).strict()

const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(500)
  }).strict()).min(1).max(24),
  slots: slotsSchema.optional()
}).strict()

export async function registerAgentRoutes(app: FastifyInstance, context: AppContext): Promise<void> {
  app.post('/v1/agent/chat', async (request, reply) => {
    const input = chatRequestSchema.parse(request.body)
    const rows = await context.db.selectFrom('airports')
      .leftJoin('cities', 'cities.id', 'airports.city_id')
      .select([
        'airports.iata_code as iata',
        'airports.name_zh as nameZh',
        'airports.name_en as nameEn',
        'cities.name_zh as cityZh',
        'cities.name_en as cityEn'
      ])
      .where('airports.active', '=', true)
      .where('airports.iata_code', 'is not', null)
      .orderBy('airports.iata_code')
      .execute()

    const airports: AgentAirport[] = rows.flatMap(row => row.iata
      ? [{
          iata: row.iata.trim().toUpperCase(),
          nameZh: row.nameZh,
          nameEn: row.nameEn,
          ...(row.cityZh ? { cityZh: row.cityZh } : {}),
          ...(row.cityEn ? { cityEn: row.cityEn } : {})
        }]
      : [])
    if (airports.length === 0) {
      throw new AppError('REFERENCE_DATA_UNAVAILABLE', 'No active airports are available for the agent', 503)
    }

    const agentInput: AgentTurnInput = {
      messages: input.messages,
      ...(input.slots ? { slots: input.slots as AgentSlots } : {})
    }
    const result = await runAgentTurn(
      context.providers.openrouter,
      agentInput,
      airports,
      new Date().toISOString().slice(0, 10)
    )
    return reply.header('Cache-Control', 'no-store').send(result)
  })
}
