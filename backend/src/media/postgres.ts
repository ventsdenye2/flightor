import { sql, type Kysely } from 'kysely'
import type { Database } from '../db/types.js'
import { PostgresPlaceRepository } from '../places/postgres.js'
import { placeSnapshot, type PlaceSnapshot } from '../places/service.js'
import { publicationFor } from '../travel-guides/publication.js'
import { readSavedFlightSelection } from '../workspaces/flight-selection.js'
import { AppError } from '../lib/errors.js'
import type { MediaRepository } from './service.js'
import type { MediaResult, MediaEnrichment } from './types.js'
const json=(v:unknown):any=>typeof v==='string'?JSON.parse(v):v
export class PostgresMediaRepository implements MediaRepository {
  constructor(private readonly db:Kysely<Database>) {}
  snapshot(owner:string,id:string){return new PostgresPlaceRepository(this.db).snapshot(owner,id)}
  async targets(s:PlaceSnapshot){
    const places=await new PostgresPlaceRepository(this.db).read(s)
    return s.hints.filter(h=>!h.scope).map(hint=>{
      const resolution=places.activities[hint.activityId]?.place
      return {hint,...(resolution?.status==='resolved'?{place:resolution.place}:{}),blocked:!!resolution&&['ambiguous','conflict'].includes(resolution.status)}
    })
  }
  async read(s:PlaceSnapshot):Promise<MediaEnrichment>{
    const rows=await sql<{activity_id:string;result_json:unknown}>`select activity_id,result_json from guide_media_bindings where user_id=${s.ownerId} and artifact_id=${s.artifact.id}::uuid and content_version=${s.contentVersion}`.execute(this.db)
    const activities:MediaEnrichment['activities']={}
    for(const row of rows.rows){if(!s.hints.some(h=>h.activityId===row.activity_id))continue
      const result=json(row.result_json) as MediaResult,photo=result.photos[0]
      activities[row.activity_id]={media:photo?{...photo,candidates:result.photos.slice(1,3)}:null,mediaStatus:result.status}
    }
    return {contentVersion:s.contentVersion,activities}
  }
  async cached(key:string){const rows=await sql<{result_json:unknown}>`select result_json from media_query_cache where query_key=${key} and expires_at>now()`.execute(this.db);return rows.rows[0]?json(rows.rows[0].result_json) as MediaResult:undefined}
  async cache(key:string,result:MediaResult){
    const ttl=result.status==='ready'?2592000:result.status==='empty'?86400:300
    await sql`insert into media_query_cache(query_key,result_json,expires_at) values(${key},${JSON.stringify(result)}::jsonb,now()+${ttl}*interval '1 second') on conflict(query_key) do update set result_json=excluded.result_json,expires_at=excluded.expires_at`.execute(this.db)
  }
  async save(s:PlaceSnapshot,id:string,result:MediaResult,signal:AbortSignal){
    await this.db.transaction().execute(async trx=>{
      const row=await trx.selectFrom('artifacts').selectAll().where('public_id','=',s.artifact.id).where('user_id','=',s.ownerId).forUpdate().executeTakeFirst()
      if(!row)throw new AppError('RESOURCE_NOT_FOUND','Artifact not found',404)
      const trip=await trx.selectFrom('trips').select(['current_context_version','saved_route_json']).where('id','=',row.trip_id).where('user_id','=',s.ownerId).forShare().executeTakeFirstOrThrow()
      const current=placeSnapshot(s.ownerId,{...s.artifact,payload:json(row.payload_json)})
      if(current.contentVersion!==s.contentVersion||trip.current_context_version!==row.trip_context_version||readSavedFlightSelection(json(trip.saved_route_json))?.revision!==publicationFor(current.artifact)?.flightSelectionRevision||!current.hints.some(h=>h.activityId===id))throw new AppError('MEDIA_CONTENT_CHANGED','Guide changed',409)
      signal.throwIfAborted()
      // Writes only this activity's media; place/city/flight rows are never touched.
      await sql`insert into guide_media_bindings(user_id,artifact_id,content_version,activity_id,result_json) values(${s.ownerId},${s.artifact.id}::uuid,${s.contentVersion},${id},${JSON.stringify(result)}::jsonb)
        on conflict(user_id,artifact_id,content_version,activity_id) do update set result_json=excluded.result_json,updated_at=now()
        where guide_media_bindings.result_json->>'checkedAt' <= excluded.result_json->>'checkedAt'`.execute(trx)
      signal.throwIfAborted()
    })
  }
}
