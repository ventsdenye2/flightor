// Frozen transport fixtures for real production components. No model calls or production writes.
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const raw = JSON.parse(fs.readFileSync('backend/test/fixtures/g1-publication-v1-original-samples.json', 'utf8'))
const examples = JSON.parse(fs.readFileSync('docs/design/budget-travel-agent/FINALIZATION_EXAMPLES_2026-09-22.json', 'utf8')).examples
function fixtures() {
  return raw.cases.map(sample => {
    const original = structuredClone(sample.legacy.artifact)
    original.tripId = `publication-ui-${sample.id}`
    const route = { ...structuredClone(sample.legacy.routeArtifact), type: 'route', tripId: original.tripId,
      createdAt: original.createdAt, updatedAt: original.updatedAt }
    const hash = createHash('sha256').update(JSON.stringify(original.payload)).digest('hex')
    const guides = Object.fromEntries(['zh', 'en'].map(locale => {
      const final = examples.find(example => example.locale === locale && example.mode === 'initial').text
      let index = 0
      const days = original.payload.days.map((day, dayIndex) => ({ ...day, theme: final.days[dayIndex].theme,
        items: day.items.map(item => {
          const activity = final.activities[index++]
          return { ...item, title: activity.name, description: activity.introduction, recommendationReason: activity.recommendationReason }
        }) }))
      return [locale, { ...original, payload: { ...original.payload, days,
        // Deliberate audit bait: a production UI must not publish these fields.
        supportingEvidence: [{ sourceArtifactId: 'source', sourceFindingId: 'finding', title: 'EVIDENCE_ONLY', description: '门票200元 Open 09:00 https://example.com/audit', category: 'practical' }],
        publication: { version: 1, artifactId: original.id, tripContextVersion: original.tripContextVersion,
          guideContentHash: hash, contentContract: 'limited', evidenceCoverage: 'partial', legacy: false,
          budgetAssessment: { status: 'undetermined', knownSubtotal: null, scopeCoverage: 'incomplete', notice: 'AUDIT_NOTICE_ONLY' },
          locale, status: 'accepted', failureKind: 'accepted', canLocalize: true, canRetry: false, revision: 1, issues: [],
          reply: final.reply, overview: final.overview, references: { ref: [{ url:'https://example.com/source', title:'Evidence 09:00 ticket 200' }] } } } }]
    }))
    const selected = sample.legacy.selectedFlightArtifact
    const flight = selected ? { ...structuredClone(selected), tripId: original.tripId, type: 'flight_search', schemaVersion: 1,
      createdAt: original.createdAt, updatedAt: original.updatedAt } : undefined
    const workspace = { trip: { id: original.tripId, title: 'Publication UI fixture', status: 'saved', version: original.tripContextVersion,
      contextVersion: original.tripContextVersion, savedRoute: null,
      selectedFlight: selected ? { kind: 'offer', artifactId: selected.id, offerId: original.payload.flightSelection.choiceId, revision: original.payload.flightSelection.revision, contextVersion: original.tripContextVersion, selectedAt: original.createdAt, layoverPreference:'airport_only' } : null,
      createdAt: original.createdAt, updatedAt: original.updatedAt },
      tripContextSummary: { version: original.tripContextVersion, travelDays: 2, notes: selected ? [] : ['机票自备'],
        departureWindow: { from: '2026-10-20', to: '2026-10-20', precision: 'exact' }, returnWindow: { from: '2026-10-21', to: '2026-10-21', precision: 'exact' },
        interests: ['culture', 'food'], destinations: {mode:'explicit',required:[],preferred:[],excluded:[]}, readyForRouteGeneration:false },
      conversationId: original.conversationId ?? null, conversations: [], artifactRefs: [{ id: original.id, type:'travel_guide',schemaVersion:1,presentationHint:'card' }],
      messages: [{id:`${sample.id}-user`,role:'user',content:'想了解文化，喜欢小吃，节奏轻松。',artifactRefs:[],createdAt:original.createdAt},
        {id:`${sample.id}-reply`,role:'assistant',content:'',artifactRefs:[{id:original.id,type:'travel_guide',schemaVersion:1,presentationHint:'card'}],delivery:{status:'satisfied',artifactIds:[original.id]},createdAt:original.createdAt}] }
    return { id: sample.id, guides, route, flight, workspace }
  })
}
module.exports = { fixtures }
