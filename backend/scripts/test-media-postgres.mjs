import assert from 'node:assert/strict'
import { sql } from 'kysely'
import { setup } from './places-test-support.mjs'
import { up } from '../dist/db/migrations/014_place_media.js'
import { PostgresPlaceRepository } from '../dist/places/postgres.js'
import { PostgresMediaRepository } from '../dist/media/postgres.js'
const h=await setup(`places_test_${Date.now()}`)
try{
 await up(h.db);const places=new PostgresPlaceRepository(h.db),media=new PostgresMediaRepository(h.db)
 const s=await media.snapshot(h.owner.userId,h.entries[0].guides.zh.id),id=s.hints[0].activityId,signal=new AbortController().signal
 const before=await sql`select payload_json from artifacts where public_id=${s.artifact.id}::uuid`.execute(h.db)
 const result={status:'empty',reason:'test',photos:[],checkedAt:new Date().toISOString()}
 await Promise.all([media.save(s,id,result,signal),places.save(s,id,{status:'unresolved',reason:'test',checkedAt:new Date().toISOString()},signal)])
 assert.equal((await media.read(s)).activities[id].mediaStatus,'empty');assert.equal((await places.read(s)).activities[id].place.reason,'test')
 assert.deepEqual((await sql`select payload_json from artifacts where public_id=${s.artifact.id}::uuid`.execute(h.db)).rows,before.rows)
 await media.cache('test',result);assert.equal((await media.cached('test')).reason,'test')
 await assert.rejects(media.snapshot('99999999',s.artifact.id))
 await assert.rejects(media.save({...s,contentVersion:'old'},id,result,signal))
 await assert.rejects(media.save(s,'unknown',result,signal))
 const newer={...result,reason:'newer',checkedAt:'2099-01-01T00:00:00.000Z'};await media.save(s,id,newer,signal);await media.save(s,id,result,signal)
 const rows=await sql`select result_json from guide_media_bindings where activity_id=${id}`.execute(h.db);assert.equal(rows.rows[0].result_json.reason,'newer')
 await sql`update trips set current_context_version=current_context_version+1 where public_id=${s.artifact.tripId}::uuid`.execute(h.db)
 await assert.rejects(media.save(s,id,result,signal));await assert.rejects(media.snapshot(h.owner.userId,s.artifact.id))
 console.log('PASS PostgreSQL concurrent place/media writes, immutable publication, cache/read restoration, owner/activity/hash/context guards and late older result ignored')
}finally{await h.close(true)}
