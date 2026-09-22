const assert=require('node:assert/strict')
const {fixtures}=require('./publication-ui-fixture.cjs')
const entries=fixtures(), selected=entries.find(e=>e.id==='selectedFlight')
assert.match(selected.textProvenance,/synthetic/)
for(const entry of entries)for(const locale of ['zh','en']){
 const guide=entry.guides[locale]
 assert.deepEqual(guide.payload.days.flatMap(d=>d.items.map(i=>i.id)),entry.guides.zh.payload.days.flatMap(d=>d.items.map(i=>i.id)))
 for(const item of guide.payload.days.flatMap(d=>d.items))if(locale==='en'){
  const slots=['morning','afternoon','evening'].filter(s=>item.description.includes(s)||item.recommendationReason.includes(s))
  assert.ok(slots.every(s=>s===item.timeOfDay),`${entry.id}/${item.id}: slot conflict`)
 }
}
assert.equal(selected.guides.en.payload.days[0].items[1].title,'Kuramae neighborhood')
assert.equal(selected.guides.en.payload.days[1].items[0].timeOfDay,'morning')
console.log('PASS both entry identities, bilingual slots and explicit synthetic provenance')
