import { z } from 'zod'

export const pointSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), system: z.literal('WGS84') }).strict()
export const placeSchema = z.object({
  placeId: z.string().max(160), name: z.string().max(300), aliases: z.array(z.string().max(300)).max(30),
  city: z.string().max(200), countryCode: z.string().regex(/^[A-Z]{2}$/), address: z.string().max(700),
  kind: z.enum(['venue', 'park', 'district', 'street', 'city', 'airport']), coordinates: pointSchema,
  source: z.object({ provider: z.literal('nominatim'), url: z.string().url(), attribution: z.string(), retrievedAt: z.string() }).strict()
}).strict()
export type Place = z.infer<typeof placeSchema>
export interface PlaceHint { activityId: string; name: string; aliases: string[]; city: string; countryCode: string; sourceUrls: string[]; scope?: 'city' }
export interface PlaceResolution {
  status: 'resolved' | 'unresolved' | 'ambiguous' | 'unavailable' | 'conflict'
  reason: string
  place?: Place
  candidates?: Array<Pick<Place, 'placeId' | 'name' | 'kind' | 'city' | 'countryCode'>>
  checkedAt: string
}
export interface AirportPoint { id:string;name:string;latitude:number;longitude:number;countryCode:string;system:'WGS84';kind:'airport';source:'flightor-reference-data' }
export interface PlaceEnrichment { contentVersion: string; activities: Record<string, { place: PlaceResolution; coordinates?: Place['coordinates'] }>; cities?: Place[]; flightPaths?:AirportPoint[][] }
export interface PlaceProvider { search(hint: PlaceHint, signal: AbortSignal): Promise<PlaceResolution> }
