import { z } from 'zod'
import { locationRefSchema } from '../aviation/types.js'

// A selector never supplies location facts. Numeric database IDs may arrive as
// JSON numbers; both forms must still match an authoritative resolved record.
export const locationIdSelectorSchema = z.union([
  z.string().min(1).max(160),
  z.number().int().nonnegative()
]).describe('Exact previously resolved location id. Prefer its original string; a safe nonnegative integer selects the identical numeric id. Unknown or ambiguous ids are rejected.')

export const locationSelectorSchema = z.union([locationIdSelectorSchema, locationRefSchema])
export type LocationSelector = z.infer<typeof locationSelectorSchema>
