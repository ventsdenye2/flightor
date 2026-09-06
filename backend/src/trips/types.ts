import { z } from 'zod'
import { locationRefSchema } from '../aviation/types.js'

const dateWindowSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  precision: z.enum(['exact', 'approximate'])
}).strict().superRefine((value, context) => {
  if (value.from && value.to && value.to < value.from) {
    context.addIssue({ code: 'custom', message: 'Window end must not precede start', path: ['to'] })
  }
})

const budgetSchema = z.object({
  amount: z.number().finite().nonnegative().max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  scope: z.enum(['airfare', 'transport', 'trip'])
}).strict()

const destinationIntentSchema = z.object({
  mode: z.enum(['explicit', 'open', 'mixed']),
  required: z.array(locationRefSchema).max(24),
  preferred: z.array(locationRefSchema).max(24),
  excluded: z.array(locationRefSchema).max(24)
}).strict()

const prioritiesSchema = z.object({
  price: z.number().min(0).max(1).optional(),
  comfort: z.number().min(0).max(1).optional(),
  experience: z.number().min(0).max(1).optional(),
  simplicity: z.number().min(0).max(1).optional()
}).strict()

const transferPreferencesSchema = z.object({
  acceptsSelfTransfer: z.boolean().optional(),
  acceptsLongStopover: z.boolean().optional(),
  acceptsAirportChange: z.boolean().optional()
}).strict()

const locationRoleOverrideSchema = z.object({
  location: locationRefSchema,
  role: z.enum(['visit', 'stopover_only', 'avoid'])
}).strict()

const activityRefSchema = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(240)
}).strict()

export const tripContextSchema = z.object({
  id: z.string().min(1).max(160),
  origin: locationRefSchema.optional(),
  departureWindow: dateWindowSchema.optional(),
  returnWindow: dateWindowSchema.optional(),
  travelDays: z.number().int().min(1).max(60).optional(),
  budget: budgetSchema.optional(),
  destinationIntent: destinationIntentSchema,
  interests: z.array(z.string().min(1).max(80)).max(32),
  pace: z.enum(['relaxed', 'balanced', 'intensive']).optional(),
  priorities: prioritiesSchema,
  transferPreferences: transferPreferencesSchema,
  locationRoleOverrides: z.array(locationRoleOverrideSchema).max(32),
  mustIncludeEvents: z.array(activityRefSchema).max(32),
  notes: z.array(z.string().min(1).max(500)).max(50),
  version: z.number().int().nonnegative()
}).strict()

export type TripContext = z.infer<typeof tripContextSchema>

export const tripContextPatchSchema = tripContextSchema
  .omit({ id: true, version: true })
  .partial()
  .extend({
    origin: locationRefSchema.nullable().optional(),
    departureWindow: dateWindowSchema.nullable().optional(),
    returnWindow: dateWindowSchema.nullable().optional(),
    travelDays: z.number().int().min(1).max(60).nullable().optional(),
    budget: budgetSchema.nullable().optional(),
    pace: z.enum(['relaxed', 'balanced', 'intensive']).nullable().optional()
  }).strict()

export type TripContextPatch = z.infer<typeof tripContextPatchSchema>

export function emptyTripContext(id: string): TripContext {
  return {
    id,
    destinationIntent: { mode: 'open', required: [], preferred: [], excluded: [] },
    interests: [],
    priorities: {},
    transferPreferences: {},
    locationRoleOverrides: [],
    mustIncludeEvents: [],
    notes: [],
    version: 0
  }
}
