import { z } from 'zod'

export const verificationRecordSchema = z.object({
  status: z.enum(['verified', 'partially_verified', 'stale', 'unverified']),
  checkedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.object({
    provider: z.string().min(1).max(64),
    reference: z.string().min(1).max(500).optional()
  }).strict()).max(20)
}).strict()

export type VerificationRecord = z.infer<typeof verificationRecordSchema>

export const locationRefSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(['city', 'airport']),
  name: z.string().min(1).max(160),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  iata: z.string().regex(/^[A-Z]{3}$/).optional(),
  cityCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezone: z.string().min(1).max(80).optional()
}).strict()

export type LocationRef = z.infer<typeof locationRefSchema>

export function locationRefKey(value: LocationRef): string {
  return JSON.stringify({
    id: value.id,
    type: value.type,
    name: value.name,
    countryCode: value.countryCode,
    iata: value.iata ?? null,
    cityCode: value.cityCode ?? null,
    latitude: value.latitude ?? null,
    longitude: value.longitude ?? null,
    timezone: value.timezone ?? null
  })
}

export const locationResolutionSchema = z.object({
  matches: z.array(locationRefSchema).max(20),
  verification: verificationRecordSchema
}).strict()

export type LocationResolution = z.infer<typeof locationResolutionSchema>

export interface AirportRoute {
  origin: LocationRef
  destination: LocationRef
  weeklyFrequency?: number
  validFrom?: string
  validTo?: string
}

export interface ScheduledFlight {
  id: string
  originIata: string
  destinationIata: string
  departureLocal?: string
  arrivalLocal?: string
  marketingCarrier?: string
  operatingCarrier?: string
  flightNumber?: string
}

export interface FlightStatus {
  id: string
  status: 'scheduled' | 'active' | 'landed' | 'cancelled' | 'unknown'
  originIata?: string
  destinationIata?: string
  scheduledDeparture?: string
  scheduledArrival?: string
  updatedAt: string
}
