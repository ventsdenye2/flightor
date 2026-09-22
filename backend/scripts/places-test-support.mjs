// Isolated synthetic trip/text transport, real production place repository and API.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { env } from '../dist/config/env.js'
import { PostgresUserIdentityRepository } from '../dist/identity/postgres.js'
import { PostgresTripRepository } from '../dist/trips/postgres.js'
import { PostgresArtifactRepository } from '../dist/artifacts/postgres.js'
import { PostgresWorkspaceRepository } from '../dist/workspaces/postgres.js'
import { buildGuidePublication, publicationFor } from '../dist/travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../dist/travel-guides/artifact.js'
import { sourceRef } from '../dist/travel-guides/finalization.js'
const require=createRequire(import.meta.url)
export async function setup(schema){
 if(!/^places_(test_\d+|map_20260922)$/.test(schema))throw Error('Invalid isolated schema')
 const url=process.env.PLACES_TEST_DATABASE_URL||env.DATABASE_URL
 if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Loopback DB required')
 const admin=new pg.Pool({connectionString:url})
 const found=await admin.query('select schema_name from information_schema.schemata where schema_name=$1',[schema])
 const fresh=!found.rows.length
 if(fresh)await admin.query(`create schema "${schema}"`)
 const db=new Kysely({dialect:new PostgresDialect({pool:new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,max:6})})})
 if(fresh)for(const file of ['001_initial','006_cloud_state','007_route_generation_runs','008_trip_workspace','010_planning_goals','013_place_enrichment'])await(await import(`../dist/db/migrations/${file}.js`)).up(db)
 const owner=await new PostgresUserIdentityRepository(db).resolveLocalTest({nickname:'Place API fixture',avatarUrl:''})
 // fixtures() resolves retained files relative to repository root.
 const entries=require('../../scripts/publication-ui-fixture.cjs').fixtures()
 const raw=JSON.parse(fs.readFileSync('backend/test/fixtures/g1-publication-v1-original-samples.json','utf8')).cases
 const artifacts=new PostgresArtifactRepository(db,owner.userId)
 for(const entry of entries){
  const sample=raw.find(s=>s.id===entry.id),original=sample.legacy.artifact
  let saved=await artifacts.get(original.id)
  if(!saved){
   const trips=new PostgresTripRepository(db,owner.userId)
   const trip=await trips.create({title:`Place fixture ${entry.id}`,initialContext:{travelDays:2,interests:['culture','food']}})
   const guide=travelGuideArtifactPayloadSchema.parse(original.payload)
   if(entry.flight){
    await artifacts.create({id:entry.flight.id,tripId:trip.id,tripContextVersion:trip.context.version,type:'flight_search',schemaVersion:1,payload:entry.flight.payload})
    const workspace=new PostgresWorkspaceRepository(db,owner.userId),current=await workspace.get(trip.id)
    await workspace.update(trip.id,{expectedVersion:current.trip.version,selectedFlight:{kind:'offer',artifactId:entry.flight.id,offerId:guide.flightSelection.choiceId,layoverPreference:'airport_only'}})
   }
   const pub=buildGuidePublication({id:original.id,tripContextVersion:trip.context.version},guide)
   pub.finalization={version:1,variants:Object.fromEntries(['zh','en'].map(locale=>{
    const displayed=entry.guides[locale].payload
    return[locale,{status:'accepted',revision:1,text:{locale,reply:displayed.publication.reply,overview:displayed.publication.overview,days:displayed.days.map(d=>({day:d.day,theme:d.theme})),activities:displayed.days.flatMap(d=>d.items).map(a=>({activityId:a.id,name:a.title,introduction:a.description,recommendationReason:a.recommendationReason,sourceRefs:[sourceRef(a)]}))},issues:[],omitted:[],observation:{durationMs:0,calls:0,promptTokens:null,completionTokens:null,knownCostUsdMicros:0,unknownCostCalls:0,failure:null}}]
   }))}
   saved=await artifacts.create({id:original.id,tripId:trip.id,tripContextVersion:trip.context.version,type:'travel_guide',schemaVersion:1,payload:{...guide,publication:pub}})
  }
  const publication=publicationFor(saved)
  if(!publication||publication.legacy)throw Error('Fixture publication invalid')
  entry.databaseTripId=saved.tripId
  for(const guide of Object.values(entry.guides))guide.payload.publication.guideContentHash=publication.guideContentHash
 }
 return{db,admin,owner,entries,env:{...env,HOST:'127.0.0.1',JWT_SECRET:'place-fixture-isolated-secret-at-least-32-chars',LOCAL_LOGIN_ENABLED:true,LOCAL_LOGIN_KEY:'place-fixture-local-key-at-least-32-chars',NODE_ENV:'development',PLACES_NOMINATIM_URL:'https://nominatim.openstreetmap.org/',PLACES_USER_AGENT:'FlightOR-place-validation/1.0 (bounded user-authorized research)'},close:async(drop=false)=>{await db.destroy();if(drop)await admin.query(`drop schema "${schema}" cascade`);await admin.end()}}
}
