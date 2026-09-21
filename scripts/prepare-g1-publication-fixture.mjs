import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { buildGuidePublication, projectGuideRecord } from '../backend/dist/travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../backend/dist/travel-guides/artifact.js'
import { presentArtifact } from '../backend/dist/artifacts/presentation.js'

const root = new URL('../', import.meta.url)
const source = JSON.parse(readFileSync(new URL('backend/test/fixtures/g1-publication-v1-original-samples.json', root), 'utf8'))
const legacyMode = process.argv.includes('--legacy')

function routeArtifact(guide, tripId) {
  const city = guide.payload.days[0]?.city || { name: 'Tokyo', cityCode: 'TYO', type: 'city' }
  return {
    id: guide.payload.routeArtifactId,
    tripId,
    type: 'route', schemaVersion: 1, tripContextVersion: guide.tripContextVersion,
    createdAt: guide.createdAt, updatedAt: guide.updatedAt,
    payload: {
      kind: 'trip_route_plan', schemaVersion: 1, tripContextVersion: guide.tripContextVersion,
      cities: [{ ...city, role: 'visit', reasons: ['fixture sample'] }],
      days: guide.payload.days.map(day => ({ day: day.day, city: day.city, activityRefs: day.items.map(item => item.id) })),
      warnings: [], landTransfers: []
    }
  }
}

const entries = source.cases.map(sample => {
  const original = sample.legacy.artifact
  const parsedPayload = travelGuideArtifactPayloadSchema.parse(original.payload)
  const guideId = legacyMode ? original.id : `g1-pub-${sample.id}-guide`
  const routeId = legacyMode ? parsedPayload.routeArtifactId : `g1-pub-${sample.id}-route`
  const content = { ...parsedPayload, routeArtifactId: routeId,
    sourceArtifactIds: parsedPayload.sourceArtifactIds.map(id => id === parsedPayload.routeArtifactId ? routeId : id) }
  const generated = legacyMode ? undefined : buildGuidePublication({ id: guideId, tripContextVersion: original.tripContextVersion }, content, (sample.legacy.researchArtifacts || []).map(item => item.payload))
  const guide = projectGuideRecord({ ...original, id: guideId, tripId: `g1-pub-${sample.id}-trip`, sourceArtifactIds: content.sourceArtifactIds, payload: legacyMode ? original.payload : { ...content, publication: generated } })
  const publication = guide.payload.publication
  const workspace = { trip: { id: guide.tripId, title: `G1 ${sample.id}`, status: 'saved', version: 1, contextVersion: original.tripContextVersion, savedRoute: null, selectedFlight: sample.legacy.selectedFlightArtifact ? { kind: 'offer', artifactId: sample.legacy.selectedFlightArtifact.id, offerId: parsedPayload.flightSelection?.choiceId || 'fixture-flight', contextVersion: original.tripContextVersion, revision: 1 } : null, createdAt: guide.createdAt, updatedAt: guide.updatedAt }, tripContextSummary: { version: original.tripContextVersion, travelDays: 2, departureWindow: { precision: 'unknown' }, returnWindow: { precision: 'unknown' } }, conversations: [], conversationId: null, messages: [{ delivery: { status: 'satisfied', artifactIds: [guide.id] } }], artifactRefs: [] }
  guide.tripId = workspace.trip.id
  const window = sample.legacy.researchArtifacts[0]?.payload.brief.travelWindow
  if (!window?.from) throw new Error('Frozen sample requires its original departure date')
  workspace.trip.status = 'planning'
  workspace.tripContextSummary.departureWindow = { from: window.from, to: window.from, precision: 'exact' }
  workspace.messages = [{ id: `${sample.id}-assistant`, role: 'assistant', content: publication.reply,
    createdAt: guide.createdAt, artifactRefs: [{ id: guide.id, type: 'travel_guide', schemaVersion: 1, presentationHint: 'card' }],
    delivery: { status: 'satisfied', artifactIds: [guide.id] } }]
  workspace.artifactRefs = workspace.messages[0].artifactRefs
  const routeSource = sample.legacy.routeArtifact
  const route = routeSource?.payload
    ? { ...routeSource, id: routeId, tripId: workspace.trip.id, type: 'route', schemaVersion: routeSource.schemaVersion || 1, createdAt: routeSource.createdAt || guide.createdAt, updatedAt: routeSource.updatedAt || guide.updatedAt, payload: { ...routeSource.payload, tripContextVersion: original.tripContextVersion } }
    : routeArtifact(guide, workspace.trip.id)
  const artifacts = [guide, route]
  if (sample.legacy.selectedFlightArtifact) artifacts.push(presentArtifact({ ...sample.legacy.selectedFlightArtifact, tripId: workspace.trip.id, type: 'flight_search', schemaVersion: sample.legacy.selectedFlightArtifact.schemaVersion || 1, createdAt: sample.legacy.selectedFlightArtifact.createdAt || guide.createdAt, updatedAt: sample.legacy.selectedFlightArtifact.updatedAt || guide.updatedAt }))
  return { id: sample.id, expectedLegacy: legacyMode, guideArtifact: guide, routeArtifact: route, artifacts, workspace,
    expectations: { days: guide.payload.days.map(day => ({ day: day.day, items: day.items.map(item => ({ title: item.title, timeOfDay: item.timeOfDay })) })),
      budgetNotice: publication.budgetAssessment.notice,
      references: guide.payload.supportingEvidence.map(item => item.title || item.description).filter(Boolean) } }
})
const output = { version: 1, source: 'g1-publication-v1-original-samples.json', entries }
mkdirSync(new URL('backend/.demo/', root), { recursive: true })
writeFileSync(new URL(`backend/.demo/g1-publication-${legacyMode ? 'legacy' : 'current'}.json`, root), JSON.stringify(output, null, 2))
console.log(JSON.stringify({ entries: entries.length, ids: entries.map(item => item.guideArtifact.id) }, null, 2))
