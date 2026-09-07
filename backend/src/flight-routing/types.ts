import { z } from 'zod'
import { locationRefSchema, verificationRecordSchema } from '../aviation/types.js'

const boundedString = (max: number) => z.string().min(1).max(max)
const dateWindowSchema = z.object({ from: z.iso.date(), to: z.iso.date() }).strict().superRefine((v, c) => {
  if (v.to < v.from) c.addIssue({ code: 'custom', message: 'Window end must not precede start', path: ['to'] })
})
const versionSchema = boundedString(64)
const warningSchema = z.array(boundedString(200)).max(50)

export const routeNodeSchema = z.object({
  location: locationRefSchema,
  role: z.enum(['origin', 'destination', 'visit', 'stopover'])
}).strict()
export type RouteNode = z.infer<typeof routeNodeSchema>

export const connectionEdgeSchema = z.object({
  id: boundedString(160), from: locationRefSchema, to: locationRefSchema,
  departureDate: z.iso.date(), arrivalDate: z.iso.date().optional(),
  durationMinutes: z.number().int().nonnegative().max(100000).optional(),
  transferMinutes: z.number().int().nonnegative().max(100000).optional(),
  transferType: z.enum(['direct', 'protected', 'self']), airportChange: z.boolean().optional(),
  fareArtifactId: boundedString(160).optional(), fareOfferId: boundedString(240).optional(),
  availability: z.enum(['verified', 'partial', 'unknown']),
  verification: verificationRecordSchema, warnings: warningSchema, reasons: warningSchema
}).strict().superRefine((v, c) => {
  if (v.from.iata && v.to.iata && v.from.iata === v.to.iata) c.addIssue({ code: 'custom', message: 'Edge endpoints must differ', path: ['to'] })
  if (v.arrivalDate && v.arrivalDate < v.departureDate) c.addIssue({ code: 'custom', message: 'Arrival must not precede departure', path: ['arrivalDate'] })
  if (v.transferType === 'protected' && v.availability === 'unknown') c.addIssue({ code: 'custom', message: 'Protected edge must be verified or partial', path: ['transferType'] })
})
export type ConnectionEdge = z.infer<typeof connectionEdgeSchema>

export const completeFlightPathSchema = z.object({
  id: boundedString(160), nodes: z.array(routeNodeSchema).min(2).max(32), edges: z.array(connectionEdgeSchema).min(1).max(31),
  totalFare: z.object({ amount: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
  totalDurationMinutes: z.number().int().nonnegative().max(500000).optional(), transferCount: z.number().int().min(0).max(30),
  feasibility: z.enum(['feasible', 'partial', 'unknown']), warnings: warningSchema
}).strict().superRefine((v, c) => {
  if (v.edges.length !== v.nodes.length - 1) c.addIssue({ code: 'custom', message: 'Path edge/node count mismatch', path: ['edges'] })
  for (let i = 0; i < v.edges.length; i++) {
    const edge = v.edges[i]!, from = v.nodes[i]!.location, to = v.nodes[i + 1]!.location
    if (edge.from.iata !== from.iata || edge.to.iata !== to.iata) c.addIssue({ code: 'custom', message: 'Path edge endpoints do not match nodes', path: ['edges', i] })
  }
})
export type CompleteFlightPath = z.infer<typeof completeFlightPathSchema>

export const routeScoreSchema = z.object({ airfareSaving: z.number().finite(), preferredCityMatch: z.number().finite(), interestMatch: z.number().finite(), eventMatch: z.number().finite(), seasonMatch: z.number().finite(), stopoverPlayability: z.number().finite(), additionalCityValue: z.number().finite(), routeNovelty: z.number().finite(), selfTransferRisk: z.number().finite(), complexity: z.number().finite(), total: z.number().finite() }).strict()
export type RouteScore = z.infer<typeof routeScoreSchema>

const routeSetCommon = {
  schemaVersion: z.literal(1), serviceVersion: versionSchema, algorithmVersion: versionSchema,
  sourceArtifactIds: z.array(boundedString(160)).max(50), verification: verificationRecordSchema,
  warnings: warningSchema, truncated: z.boolean(), exhausted: z.boolean()
}
const scoredPathSchema = z.object({ path: completeFlightPathSchema, score: routeScoreSchema }).strict()
export const routeSetPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ ...routeSetCommon, kind: z.literal('connection_edges'), edges: z.array(connectionEdgeSchema).max(500) }).strict(),
  z.object({ ...routeSetCommon, kind: z.literal('flight_paths'), paths: z.array(completeFlightPathSchema).max(200) }).strict(),
  z.object({
    ...routeSetCommon,
    kind: z.literal('optimized_routes'),
    representatives: z.array(scoredPathSchema).max(50),
    paretoFrontierCount: z.number().int().nonnegative().max(200),
    rejectedCandidateCount: z.number().int().nonnegative().max(200)
  }).strict()
])
export type RouteSetPayload = z.infer<typeof routeSetPayloadSchema>

export const connectionSearchInputSchema = z.object({ origin: locationRefSchema, destination: locationRefSchema, window: dateWindowSchema, preferredLocations: z.array(locationRefSchema).max(24).default([]), excludedLocations: z.array(locationRefSchema).max(24).default([]), acceptsSelfTransfer: z.boolean().default(false), acceptsLongStopover: z.boolean().default(false), maxCandidates: z.number().int().min(1).max(500).default(100) }).strict()
export type ConnectionSearchInput = z.infer<typeof connectionSearchInputSchema>
export const connectionSearchResultSchema = z.object({ edges: z.array(connectionEdgeSchema).max(500), serviceVersion: versionSchema, verification: verificationRecordSchema, warnings: warningSchema, truncated: z.boolean(), exhausted: z.boolean() }).strict()
export type ConnectionSearchResult = z.infer<typeof connectionSearchResultSchema>

export const flightRoutePlanInputSchema = z.object({ nodes: z.array(routeNodeSchema).min(2).max(24), edges: z.array(connectionEdgeSchema).min(1).max(500), window: dateWindowSchema, maxPaths: z.number().int().min(1).max(200).default(50) }).strict()
export type FlightRoutePlanInput = z.infer<typeof flightRoutePlanInputSchema>
export const flightRoutePlanResultSchema = z.object({ paths: z.array(completeFlightPathSchema).max(200), serviceVersion: versionSchema, verification: verificationRecordSchema, warnings: warningSchema, truncated: z.boolean(), exhausted: z.boolean() }).strict()
export type FlightRoutePlanResult = z.infer<typeof flightRoutePlanResultSchema>

export const routeOptimizationInputSchema = z.object({ paths: z.array(completeFlightPathSchema).min(1).max(200), weights: z.record(z.string(), z.number().finite()).default({}), maxRepresentatives: z.number().int().min(1).max(50).default(10) }).strict()
export type RouteOptimizationInput = z.infer<typeof routeOptimizationInputSchema>
export const routeOptimizationResultSchema = z.object({
  representatives: z.array(scoredPathSchema).max(50),
  paretoFrontierCount: z.number().int().nonnegative().max(200),
  rejectedCandidateCount: z.number().int().nonnegative().max(200),
  serviceVersion: versionSchema, algorithmVersion: versionSchema,
  verification: verificationRecordSchema, warnings: warningSchema,
  truncated: z.boolean(), exhausted: z.boolean()
}).strict()
export type RouteOptimizationResult = z.infer<typeof routeOptimizationResultSchema>

export type RouteServiceContext = { signal?: AbortSignal }
export interface ConnectionSearchService { search(input: ConnectionSearchInput, context?: RouteServiceContext): Promise<ConnectionSearchResult> }
export interface FlightRoutePlanner { plan(input: FlightRoutePlanInput, context?: RouteServiceContext): Promise<FlightRoutePlanResult> }
export interface RouteOptimizer { optimize(input: RouteOptimizationInput, context?: RouteServiceContext): Promise<RouteOptimizationResult> }
