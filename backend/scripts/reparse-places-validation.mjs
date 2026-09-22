// Development-only correction of isolated validation records using preserved live responses.
// Never changes production data, trip text or the call ledger; no network requests.
import fs from 'node:fs'
import { sql } from 'kysely'
import { setup } from './places-test-support.mjs'
import { PostgresPlaceRepository } from '../dist/places/postgres.js'
import { resolveCandidates,queryName } from '../dist/places/nominatim.js'
const directory='backend/.demo/places-map-20260922',h=await setup('places_map_20260922'),repo=new PostgresPlaceRepository(h.db)
try{
 const ledger=JSON.parse(fs.readFileSync(`${directory}/ledger.json`,'utf8'))
 const changes=[]
 for(const entry of h.entries){const s=await repo.snapshot(h.owner.userId,entry.guides.zh.id)
  for(const hint of s.hints){
   const name=queryName([hint.name,...hint.aliases].find(n=>/^[\x20-\x7e]+$/.test(n))??hint.name)
   const call=ledger.calls.findLast(c=>c.status==='200'&&new URL(c.url).searchParams.get('q')===`${name}, ${hint.city}`)
   if(!call)continue
   const result=resolveCandidates(JSON.parse(fs.readFileSync(`${directory}/response-${call.number}.json`,'utf8')),hint)
   const prior=(await repo.read(s)).activities[hint.activityId]?.place
   if(prior?.status!=='unresolved'||result.status!=='resolved')continue
   changes.push({activityId:hint.activityId,response:call.number,prior,result})
   // Scope is hard-coded isolated schema, current owner/hash and only previously unresolved bindings.
   await sql`update guide_place_bindings set result_json=${JSON.stringify(result)}::jsonb where user_id=${h.owner.userId} and artifact_id=${s.artifact.id}::uuid and content_version=${s.contentVersion} and activity_id=${hint.activityId} and result_json->>'status'='unresolved'`.execute(h.db)
  }
 }
 fs.writeFileSync(`${directory}/reparse-${Date.now()}.json`,JSON.stringify({reason:'Parser corrected using returned category/address granularity; no repeated POI calls',changes},null,2))
 console.log(changes.map(c=>({id:c.activityId,response:c.response,place:c.result.place.name,kind:c.result.place.kind})))
}finally{await h.close()}
