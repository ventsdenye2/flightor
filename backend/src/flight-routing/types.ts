import { z } from 'zod'
import { locationRefSchema, verificationRecordSchema } from '../aviation/types.js'

const boundedString = (max: number) => z.string().min(1).max(max)
const MAX_WINDOW_DAYS = 366
const dateWindowSchema = z.object({ from: z.iso.date(), to: z.iso.date() }).strict().superRefine((v, c) => {
  if (v.to < v.from) c.addIssue({ code: 'custom', message: 'Window end must not precede start', path: ['to'] })
  const span = (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000
  if (span > MAX_WINDOW_DAYS) c.addIssue({ code: 'custom', message: `Window must not exceed ${MAX_WINDOW_DAYS} days`, path: ['to'] })
})
const versionSchema = boundedString(64)
const warningSchema = z.array(boundedString(200)).max(50)

export const routeNodeSchema = z.object({
  location: locationRefSchema,
  role: z.enum(['origin', 'destination', 'visit', 'stopover'])
}).strict()
export type RouteNode = z.infer<typeof routeNodeSchema>

export const routeSegmentSchema = z.object({
  id: boundedString(160), from: locationRefSchema, to: locationRefSchema,
  departureAt: z.iso.datetime({ offset: true }).optional(),
  arrivalAt: z.iso.datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().nonnegative().max(100000).optional(),
  marketingCarrier: boundedString(80).optional(), operatingCarrier: boundedString(80).optional(),
  flightNumber: boundedString(32).optional(), verification: verificationRecordSchema
}).strict().superRefine((v, c) => {
  if (v.from.iata && v.to.iata && v.from.iata === v.to.iata) c.addIssue({ code: 'custom', message: 'Segment endpoints must differ', path: ['to'] })
  if (v.departureAt && v.arrivalAt && Date.parse(v.arrivalAt) < Date.parse(v.departureAt)) c.addIssue({ code: 'custom', message: 'Segment arrival must not precede departure', path: ['arrivalAt'] })
})
export type RouteSegment = z.infer<typeof routeSegmentSchema>

export const connectionEdgeSchema = z.object({
  id: boundedString(160), from: locationRefSchema, to: locationRefSchema,
  departureDate: z.iso.date(), arrivalDate: z.iso.date().optional(),
  departureAt: z.iso.datetime({ offset: true }).optional(), arrivalAt: z.iso.datetime({ offset: true }).optional(),
  durationMinutes: z.number().int().nonnegative().max(100000).optional(),
  transferMinutes: z.number().int().nonnegative().max(100000).optional(),
  transferType: z.enum(['direct', 'protected', 'self']), airportChange: z.boolean().optional(),
  segments: z.array(routeSegmentSchema).min(1).max(4).optional(),
  fare: z.object({ amount: z.number().finite().nonnegative(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().optional(),
  fareArtifactId: boundedString(160).optional(), fareOfferId: boundedString(240).optional(),
  availability: z.enum(['verified', 'partial', 'unknown']),
  verification: verificationRecordSchema, warnings: warningSchema, reasons: warningSchema
}).strict().superRefine((v, c) => {
  if (v.from.iata && v.to.iata && v.from.iata === v.to.iata) c.addIssue({ code: 'custom', message: 'Edge endpoints must differ', path: ['to'] })
  if (v.arrivalDate && v.arrivalDate < v.departureDate) c.addIssue({ code: 'custom', message: 'Arrival must not precede departure', path: ['arrivalDate'] })
  if (v.departureAt && v.arrivalAt && Date.parse(v.arrivalAt) < Date.parse(v.departureAt)) c.addIssue({ code: 'custom', message: 'Arrival instant must not precede departure instant', path: ['arrivalAt'] })
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

const normalizedScore = z.number().finite().min(0).max(1)
export const routeScoreSchema = z.object({
  airfareSaving: normalizedScore, preferredCityMatch: normalizedScore,
  interestMatch: normalizedScore, eventMatch: normalizedScore,
  seasonMatch: normalizedScore, stopoverPlayability: normalizedScore,
  additionalCityValue: normalizedScore, routeNovelty: normalizedScore,
  totalTravelTime: normalizedScore, transferCount: normalizedScore,
  selfTransferRisk: normalizedScore, airportChangePenalty: normalizedScore,
  backtrackingPenalty: normalizedScore, deadTimePenalty: normalizedScore,
  excessiveComplexity: normalizedScore,
  /** Compatibility aggregate retained while callers migrate to explicit penalties. */
  complexity: normalizedScore,
  total: z.number().finite().min(-1).max(1)
}).strict()
export type RouteScore = z.infer<typeof routeScoreSchema>

export const routeBadgeSchema = z.enum(['cheapest', 'balanced', 'most_fun', 'best_match'])
export type RouteBadge = z.infer<typeof routeBadgeSchema>

export const routeExplanationSchema = z.object({
  scoreBreakdown: z.array(z.object({
    dimension: boundedString(64), value: normalizedScore,
    weight: normalizedScore, contribution: z.number().finite().min(-1).max(1),
    direction: z.enum(['positive', 'negative']), reason: boundedString(240)
  }).strict()).max(32),
  hardConstraintsSatisfied: z.array(boundedString(200)).max(32),
  tradeoffs: z.array(boundedString(240)).max(32),
  warnings: warningSchema
}).strict()
export type RouteExplanation = z.infer<typeof routeExplanationSchema>

const routeSetCommon = {
  schemaVersion: z.literal(1), serviceVersion: versionSchema, algorithmVersion: versionSchema,
  sourceArtifactIds: z.array(boundedString(160)).max(50), verification: verificationRecordSchema,
  warnings: warningSchema, truncated: z.boolean(), exhausted: z.boolean()
}
export const scoredPathSchema = z.object({
  path: completeFlightPathSchema, score: routeScoreSchema,
  badges: z.array(routeBadgeSchema).max(4), explanation: routeExplanationSchema
}).strict()
export type ScoredPath = z.infer<typeof scoredPathSchema>
export const routeSetPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    ...routeSetCommon, kind: z.literal('connection_edges'),
    query: z.object({ origin: locationRefSchema, destination: locationRefSchema, window: dateWindowSchema }).strict(),
    edges: z.array(connectionEdgeSchema).max(500)
  }).strict(),
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
export const connectionSearchResultSchema = z.object({
  edges: z.array(connectionEdgeSchema).max(500), serviceVersion: versionSchema,
  topologyVersion: boundedString(160).optional(),
  coverageStatus: z.enum(['reachable', 'unreachable', 'unknown']).optional(),
  verification: verificationRecordSchema, warnings: warningSchema,
  truncated: z.boolean(), exhausted: z.boolean()
}).strict()
export type ConnectionSearchResult = z.infer<typeof connectionSearchResultSchema>

export const routeConstraintsSchema = z.object({
  requiredLocations: z.array(locationRefSchema).max(24).default([]),
  excludedLocations: z.array(locationRefSchema).max(24).default([]),
  maxStops: z.number().int().min(0).max(30).optional(),
  maxTransfers: z.number().int().min(0).max(30).default(4),
  allowSelfTransfer: z.boolean().default(false),
  allowAirportChange: z.boolean().default(false),
  allowLongStopover: z.boolean().default(true),
  minTransferMinutes: z.number().int().min(0).max(1440).default(45),
  maxTotalDurationMinutes: z.number().int().min(1).max(500000).optional(),
  maxTravelDays: z.number().int().min(1).max(365).optional()
}).strict()
export type RouteConstraints = z.infer<typeof routeConstraintsSchema>

export const flightRoutePlanInputSchema = z.object({
  nodes: z.array(routeNodeSchema).min(2).max(24),
  edges: z.array(connectionEdgeSchema).min(1).max(500), window: dateWindowSchema,
  constraints: routeConstraintsSchema.default({
    requiredLocations: [], excludedLocations: [], maxTransfers: 4,
    allowSelfTransfer: false, allowAirportChange: false, allowLongStopover: true,
    minTransferMinutes: 45
  }),
  maxPaths: z.number().int().min(1).max(200).default(50)
}).strict()
export type FlightRoutePlanInput = z.infer<typeof flightRoutePlanInputSchema>
export const flightRoutePlanResultSchema = z.object({ paths: z.array(completeFlightPathSchema).max(200), serviceVersion: versionSchema, verification: verificationRecordSchema, warnings: warningSchema, truncated: z.boolean(), exhausted: z.boolean() }).strict()
export type FlightRoutePlanResult = z.infer<typeof flightRoutePlanResultSchema>

export const routeWeightsSchema = z.object({
  airfareSaving: z.number().finite().min(0).max(10).optional(),
  preferredCityMatch: z.number().finite().min(0).max(10).optional(),
  interestMatch: z.number().finite().min(0).max(10).optional(),
  eventMatch: z.number().finite().min(0).max(10).optional(),
  seasonMatch: z.number().finite().min(0).max(10).optional(),
  stopoverPlayability: z.number().finite().min(0).max(10).optional(),
  additionalCityValue: z.number().finite().min(0).max(10).optional(),
  routeNovelty: z.number().finite().min(0).max(10).optional(),
  totalTravelTime: z.number().finite().min(0).max(10).optional(),
  transferCount: z.number().finite().min(0).max(10).optional(),
  selfTransferRisk: z.number().finite().min(0).max(10).optional(),
  airportChangePenalty: z.number().finite().min(0).max(10).optional(),
  backtrackingPenalty: z.number().finite().min(0).max(10).optional(),
  deadTimePenalty: z.number().finite().min(0).max(10).optional(),
  excessiveComplexity: z.number().finite().min(0).max(10).optional(),
  /** Deprecated compatibility alias for excessiveComplexity. */
  complexity: z.number().finite().min(0).max(10).optional()
}).strict()
export type RouteWeights = z.infer<typeof routeWeightsSchema>

export const routeOptimizationInputSchema = z.object({
  paths: z.array(completeFlightPathSchema).min(1).max(200),
  weights: routeWeightsSchema.default({}),
  preferredLocations: z.array(locationRefSchema).max(24).default([]),
  interestLocations: z.array(locationRefSchema).max(24).default([]),
  maxRepresentatives: z.number().int().min(1).max(50).default(10)
}).strict()
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

export type RouteServiceContext = {
  signal?: AbortSignal
  tripId?: string
  conversationId?: string
  /** Persistent cancellation/ownership checkpoint used before expensive provider boundaries. */
  checkpoint?: () => Promise<void>
}
export interface ConnectionSearchService { search(input: ConnectionSearchInput, context?: RouteServiceContext): Promise<ConnectionSearchResult> }
export interface FlightRoutePlanner { plan(input: FlightRoutePlanInput, context?: RouteServiceContext): Promise<FlightRoutePlanResult> }
export interface RouteOptimizer { optimize(input: RouteOptimizationInput, context?: RouteServiceContext): Promise<RouteOptimizationResult> }
