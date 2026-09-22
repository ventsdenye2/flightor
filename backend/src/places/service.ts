import { placeFailureDetail } from './diagnostics.js'
import { createHash } from 'node:crypto'
import type { ArtifactRecord } from '../artifacts/repository.js'
import { publicationFor } from '../travel-guides/publication.js'
import { travelGuideArtifactPayloadSchema } from '../travel-guides/artifact.js'
import { AppError } from '../lib/errors.js'
import type { PlaceEnrichment, PlaceHint, PlaceProvider, PlaceResolution } from './types.js'

export interface PlaceSnapshot { ownerId:string;artifact:ArtifactRecord;contentVersion:string;hints:PlaceHint[] }
export interface PlaceRepository {
  snapshot(ownerId:string,artifactId:string):Promise<PlaceSnapshot>
  read(snapshot:PlaceSnapshot):Promise<PlaceEnrichment>
  save(snapshot:PlaceSnapshot,key:string,result:PlaceResolution,signal:AbortSignal):Promise<void>
  cached(key:string):Promise<PlaceResolution|undefined>
  cache(key:string,result:PlaceResolution):Promise<PlaceResolution>
}
export function placeSnapshot(ownerId:string,artifact:ArtifactRecord):PlaceSnapshot {
  const pub=publicationFor(artifact), guide=travelGuideArtifactPayloadSchema.safeParse(artifact.payload)
  const finals=Object.values(pub?.finalization?.variants??{}).filter(v=>v?.status==='accepted'&&v.text).map(v=>v!.text!)
  if(!guide.success || !pub || pub.legacy || !finals.length)throw new AppError('PLACE_BASE_UNAVAILABLE','An accepted guide is required',409)
  const hints:PlaceHint[]=guide.data.days.flatMap(day=>day.items.map(item=>({activityId:item.id,name:item.title,
    aliases:[...new Set(finals.flatMap(f=>f.activities.filter(a=>a.activityId===item.id).map(a=>a.name)))],
    city:item.city.name,countryCode:item.city.countryCode??'',sourceUrls:[...new Set([...item.verification.sources.map(s=>s.reference),...(pub.references[JSON.stringify([item.sourceArtifactId,item.sourceFindingId])]??[]).map(s=>s.url)].filter((s):s is string=>typeof s==='string'&&/^https:\/\//.test(s)))]})))
  for(const city of new Map(guide.data.days.map(d=>[d.city.id,d.city])).values())hints.push({activityId:`city:${city.id}`,name:city.name,aliases:[],city:city.name,countryCode:city.countryCode??'',sourceUrls:[],scope:'city'})
  return{ownerId,artifact,contentVersion:pub.guideContentHash,hints}
}
export class PlaceService {
  private active=new Map<string,Promise<PlaceEnrichment>>()
  private queries=new Map<string,Promise<PlaceResolution>>()
  constructor(private readonly repo:PlaceRepository,private readonly provider:PlaceProvider,private readonly namespace:string){}
  async read(ownerId:string,id:string){return this.repo.read(await this.repo.snapshot(ownerId,id))}
  async resolve(ownerId:string,id:string,version:string,signal:AbortSignal):Promise<PlaceEnrichment>{
    const snapshot=await this.repo.snapshot(ownerId,id)
    if(snapshot.contentVersion!==version)throw new AppError('PLACE_CONTENT_CHANGED','Guide changed',409)
    signal.throwIfAborted()
    const key=`${ownerId}:${id}:${version}`
    const existing=this.active.get(key);if(existing)return existing
    const promise=this.perform(snapshot,AbortSignal.any([signal,AbortSignal.timeout(25000)]))
    this.active.set(key,promise)
    try{return await promise}finally{if(this.active.get(key)===promise)this.active.delete(key)}
  }
  private async perform(snapshot:PlaceSnapshot,signal:AbortSignal):Promise<PlaceEnrichment>{
    const existing=await this.repo.read(snapshot)
    let count=0
    // Complete specific activities first; city lookup is independently typed and never a POI fallback.
    for(const hint of snapshot.hints){
      signal.throwIfAborted()
      const old=existing.activities[hint.activityId]?.place
      if(old && old.status!=='unavailable')continue
      if(count++>=12){await this.repo.save(snapshot,hint.activityId,{status:'unavailable',reason:'action_limit',checkedAt:new Date().toISOString()},signal);continue}
      // Source evidence can disambiguate same-name entities; don't reuse another
      // query's decision when that evidence differs. Locale is still not a key.
      const cacheKey=createHash('sha256').update(JSON.stringify([this.namespace,hint.name.normalize('NFKC'),hint.city,hint.countryCode,hint.scope??'activity',[...new Set(hint.sourceUrls)].sort()])).digest('hex')
      let result=await this.repo.cached(cacheKey)
      if(!result){
        let query=this.queries.get(cacheKey)
        if(!query){query=this.provider.search(hint,signal).catch(error=>{
          signal.throwIfAborted()
            return{status:'unavailable' as const,reason:error instanceof Error && error.name==='TimeoutError'?'timeout':'provider_failure',checkedAt:new Date().toISOString(),diagnostic:placeFailureDetail(error)}
        }).then(value=>this.repo.cache(cacheKey,value))
          this.queries.set(cacheKey,query);void query.finally(()=>{if(this.queries.get(cacheKey)===query)this.queries.delete(cacheKey)}).catch(()=>{})}
        result=await query
      }
      signal.throwIfAborted()
      await this.repo.save(snapshot,hint.activityId,result,signal)
    }
    // Re-check owner, context, flight and content after external work; late results cannot be returned as current.
    const current=await this.repo.snapshot(snapshot.ownerId,snapshot.artifact.id)
    if(current.contentVersion!==snapshot.contentVersion)throw new AppError('PLACE_CONTENT_CHANGED','Guide changed',409)
    return this.repo.read(current)
  }
}
