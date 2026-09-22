import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { sql } from 'kysely'
import { setup } from './places-test-support.mjs'
import { PostgresPlaceRepository } from '../dist/places/postgres.js'
import { PlaceService } from '../dist/places/service.js'
import { registerPlaceRoutes } from '../dist/routes/places.js'
import { issueAccessToken } from '../dist/auth/tokens.js'
const h=await setup(`places_test_${Date.now()}`),repo=new PostgresPlaceRepository(h.db)
let calls=0
const result={status:'resolved',reason:'offline_fixture',checkedAt:new Date().toISOString(),place:{placeId:'osm:way:123',name:'Synthetic park',aliases:[],kind:'park',city:'Tokyo',countryCode:'JP',address:'Synthetic',coordinates:{latitude:35.71,longitude:139.77,system:'WGS84'},source:{provider:'nominatim',url:'https://www.openstreetmap.org/way/123',attribution:'© OpenStreetMap contributors',retrievedAt:new Date().toISOString()}}}
const service=new PlaceService(repo,{search:async()=>{calls++;return result}},'offline')
const app=Fastify(),context={db:h.db,env:h.env,places:service}
app.setErrorHandler((e,req,reply)=>reply.code(e.statusCode??(e.name==='ZodError'?400:500)).send({code:e.code}))
await registerPlaceRoutes(app,context)
const headers={authorization:`Bearer ${await issueAccessToken({...h.owner,localTest:true},h.env)}`}
try{
 const id=h.entries[0].guides.zh.id,url=`/v1/artifacts/${id}/places`,snapshot=await repo.snapshot(h.owner.userId,id),version=snapshot.contentVersion
 assert.equal((await app.inject({url})).statusCode,401)
 assert.equal((await app.inject({url,headers})).statusCode,200);assert.equal(calls,0)
 assert.equal((await app.inject({url,headers,method:'POST',payload:{contentVersion:'bad'}})).statusCode,400)
 assert.equal((await app.inject({url,headers,method:'POST',payload:{contentVersion:'f'.repeat(64)}})).statusCode,409)
 const both=await Promise.all([1,2].map(()=>app.inject({url,headers,method:'POST',payload:{contentVersion:version}})))
 assert.ok(both.every(r=>r.statusCode===200));const before=calls
 assert.equal((await app.inject({url,headers})).statusCode,200)
 await service.resolve(h.owner.userId,id,version,new AbortController().signal);assert.equal(calls,before)
 assert.deepEqual(await new PostgresPlaceRepository(h.db).read(snapshot),both[0].json().enrichment)
 await assert.rejects(repo.snapshot('999999',id))
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(repo.save(snapshot,snapshot.hints[0].activityId,result,cancelled.signal))
 const oldPayload=await h.db.selectFrom('artifacts').select('payload_json').where('public_id','=',id).executeTakeFirstOrThrow()
 await repo.cache('conflict-test',result)
 const changed=structuredClone(result);changed.place.placeId='osm:way:456'
 const conflict=await repo.cache('conflict-test',changed);assert.equal(conflict.status,'conflict');assert.equal(conflict.place.placeId,'osm:way:123')
 assert.deepEqual((await h.db.selectFrom('artifacts').select('payload_json').where('public_id','=',id).executeTakeFirstOrThrow()).payload_json,oldPayload.payload_json)
 await sql`update trips set current_context_version=current_context_version+1 where public_id=${h.entries[0].databaseTripId}::uuid`.execute(h.db)
 await assert.rejects(repo.save(snapshot,snapshot.hints[0].activityId,result,new AbortController().signal))
 await assert.rejects(repo.snapshot(h.owner.userId,id))
 const selected=await repo.snapshot(h.owner.userId,h.entries[1].guides.zh.id)
 await sql`update trips set saved_route_json=null where public_id=${h.entries[1].databaseTripId}::uuid`.execute(h.db)
 await assert.rejects(repo.save(selected,selected.hints[0].activityId,result,new AbortController().signal))
 console.log(JSON.stringify({passed:true,checks:['authentication','strict POST','GET no query','concurrency','persistent restore','owner','cancellation','identity conflict','immutable artifact','Trip version','flight revision'],provider:'offline fixture',calls}))
}finally{await app.close();await h.close(true)}
