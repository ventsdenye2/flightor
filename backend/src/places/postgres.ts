import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { sql, type Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import { PostgresArtifactRepository } from '../artifacts/postgres.js'
import { PostgresTripRepository } from '../trips/postgres.js'
import { PostgresWorkspaceRepository } from '../workspaces/postgres.js'
import { readSavedFlightSelection } from '../workspaces/flight-selection.js'
import { publicationFor } from '../travel-guides/publication.js'
import { AppError } from '../lib/errors.js'
import { placeSnapshot, type PlaceRepository, type PlaceSnapshot } from './service.js'
import type { AirportPoint, PlaceEnrichment, PlaceResolution } from './types.js'

const json=(value:unknown):any=>typeof value==='string'?JSON.parse(value):value
export class PostgresPlaceRepository implements PlaceRepository {
 constructor(private readonly db:Kysely<Database>){}
 async snapshot(ownerId:string,id:string){
  const artifact=await new PostgresArtifactRepository(this.db,ownerId).get(id)
  if(!artifact)throw new AppError('RESOURCE_NOT_FOUND','Artifact was not found',404)
  const snapshot=placeSnapshot(ownerId,artifact)
  const trip=await new PostgresTripRepository(this.db,ownerId).get(artifact.tripId)
  const selected=await new PostgresWorkspaceRepository(this.db,ownerId).getSelectedFlight(artifact.tripId)
  if(trip?.version!==artifact.tripContextVersion || selected?.selection.revision!==publicationFor(artifact)?.flightSelectionRevision)throw new AppError('PLACE_CONTENT_CHANGED','Trip or flight changed',409)
  return snapshot
 }
 async read(s:PlaceSnapshot):Promise<PlaceEnrichment>{
  const rows=await sql<{activity_id:string;result_json:unknown}>`select activity_id,result_json from guide_place_bindings where user_id=${s.ownerId} and artifact_id=${s.artifact.id}::uuid and content_version=${s.contentVersion}`.execute(this.db)
  const activities:PlaceEnrichment['activities']={}, cities:NonNullable<PlaceEnrichment['cities']>=[]
  for(const row of rows.rows){if(!s.hints.some(h=>h.activityId===row.activity_id))continue;const result=json(row.result_json) as PlaceResolution
   activities[row.activity_id]={place:result,...(result.status==='resolved'&&result.place?{coordinates:result.place.coordinates}:{})}
   if(row.activity_id.startsWith('city:')&&result.status==='resolved'&&result.place)cities.push(result.place)
  }
  const selected=await new PostgresWorkspaceRepository(this.db,s.ownerId).getSelectedFlight(s.artifact.tripId)
  const flightPaths:AirportPoint[][]=[]
  if(selected){
   const codes=[...new Set(selected.segments.flatMap(segment=>[segment.origin,segment.destination]))].filter(code=>/^[A-Z]{3}$/.test(code))
   if(codes.length){const airports=await this.db.selectFrom('airports').select(['id','iata_code','name_en','country_code','latitude','longitude']).where('iata_code','in',codes).where('active','=',true).execute()
    const point=(code:string):AirportPoint|undefined=>{const a=airports.find(a=>a.iata_code===code);return a&&a.latitude!==null&&a.longitude!==null?{id:`airport:${a.id}`,name:code,latitude:a.latitude,longitude:a.longitude,countryCode:a.country_code,system:'WGS84',kind:'airport',source:'flightor-reference-data'}:undefined}
    for(const segment of selected.segments){const from=point(segment.origin),to=point(segment.destination);if(from&&to)flightPaths.push([from,to])}
   }
  }
  return{contentVersion:s.contentVersion,activities,cities,flightPaths}
 }
 async save(s:PlaceSnapshot,key:string,result:PlaceResolution,signal:AbortSignal){
  await this.db.transaction().execute(async trx=>{
   const row=await trx.selectFrom('artifacts').selectAll().where('public_id','=',s.artifact.id).where('user_id','=',s.ownerId).forUpdate().executeTakeFirst()
   if(!row)throw new AppError('RESOURCE_NOT_FOUND','Artifact was not found',404)
   const trip=await trx.selectFrom('trips').select(['current_context_version','saved_route_json']).where('id','=',row.trip_id).where('user_id','=',s.ownerId).forShare().executeTakeFirstOrThrow()
   const current=placeSnapshot(s.ownerId,{...s.artifact,payload:json(row.payload_json)})
   const selected=readSavedFlightSelection(json(trip.saved_route_json))
   if(current.contentVersion!==s.contentVersion||trip.current_context_version!==row.trip_context_version||selected?.revision!==publicationFor(current.artifact)?.flightSelectionRevision||!current.hints.some(h=>h.activityId===key))throw new AppError('PLACE_CONTENT_CHANGED','Guide changed',409)
   signal.throwIfAborted()
   const old=await sql<{result_json:unknown}>`select result_json from guide_place_bindings where user_id=${s.ownerId} and artifact_id=${s.artifact.id}::uuid and content_version=${s.contentVersion} and activity_id=${key} for update`.execute(trx)
   const prior=json(old.rows[0]?.result_json) as PlaceResolution|undefined
   if(prior&&prior.status!=='unavailable')return // Accepted or unresolved identity never silently replaced by late work.
   await sql`insert into guide_place_bindings(user_id,artifact_id,content_version,activity_id,result_json) values (${s.ownerId},${s.artifact.id}::uuid,${s.contentVersion},${key},${JSON.stringify(result)}::jsonb)
    on conflict(user_id,artifact_id,content_version,activity_id) do update set result_json=excluded.result_json,updated_at=now()`.execute(trx)
   signal.throwIfAborted()
  })
 }
 async cached(key:string){const r=await sql<{result_json:unknown}>`select result_json from place_query_cache where query_key=${key} and expires_at>now()`.execute(this.db);return r.rows[0]?json(r.rows[0].result_json) as PlaceResolution:undefined}
 async cache(key:string,result:PlaceResolution){
  return this.db.transaction().execute(async trx=>{
   await sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`.execute(trx)
   const old=await sql<{result_json:unknown}>`select result_json from place_query_cache where query_key=${key} for update`.execute(trx)
   const prior=json(old.rows[0]?.result_json) as PlaceResolution|undefined
   if(prior?.place&&result.place&&prior.place.placeId!==result.place.placeId){
    const {placeId,name,kind,city,countryCode}=result.place
    result={status:'conflict',reason:'identity_changed',place:prior.place,candidates:[{placeId,name,kind,city,countryCode}],checkedAt:result.checkedAt}
   }else if(prior?.status==='conflict')result=prior
   const seconds=result.status==='resolved'?2592000:result.status==='unavailable'?300:86400
   await sql`insert into place_query_cache(query_key,result_json,expires_at) values(${key},${JSON.stringify(result)}::jsonb,now()+${seconds}*interval '1 second') on conflict(query_key) do update set result_json=excluded.result_json,expires_at=excluded.expires_at`.execute(trx)
   return result
  })
 }
 /** Global DB lease prevents multi-instance requests exceeding public-service limits. No network in transaction. */
 async reserve(signal:AbortSignal){
  for(;;){signal.throwIfAborted();const id=randomUUID()
   const obtained=await this.db.transaction().execute(async trx=>{
    await sql`select pg_advisory_xact_lock(79130241)`.execute(trx)
    const busy=await sql`select id from place_provider_calls where lease_until>now() or started_at>now()-interval '1100 milliseconds' limit 1`.execute(trx)
    if(busy.rows.length)return false
    await sql`insert into place_provider_calls(id,lease_until) values(${id}::uuid,now()+interval '30 seconds')`.execute(trx);return true
   })
   if(obtained)return async(outcome='finished')=>{await sql`update place_provider_calls set finished_at=now(),lease_until=now(),status=${outcome.slice(0,40)} where id=${id}::uuid`.execute(this.db)}
   await delay(250,undefined,{signal})
  }
 }
}
