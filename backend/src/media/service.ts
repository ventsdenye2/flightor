import { createHash } from 'node:crypto'
import { AppError } from '../lib/errors.js'
import type { PlaceSnapshot } from '../places/service.js'
import type { MediaEnrichment, MediaProvider, MediaResult, MediaTarget } from './types.js'

export interface MediaRepository {
  snapshot(owner:string,id:string):Promise<PlaceSnapshot>
  targets(snapshot:PlaceSnapshot):Promise<MediaTarget[]>
  read(snapshot:PlaceSnapshot):Promise<MediaEnrichment>
  cached(key:string):Promise<MediaResult|undefined>
  cache(key:string,result:MediaResult):Promise<void>
  save(snapshot:PlaceSnapshot,id:string,result:MediaResult,signal:AbortSignal):Promise<void>
}
export function mediaCacheKey(target:MediaTarget) {
  return createHash('sha256').update(JSON.stringify(['wikimedia-v1','entity-photo',960,
    target.place?['place',target.place.placeId]:['activity',target.hint.name,target.hint.city,target.hint.countryCode,[...target.hint.sourceUrls].sort()],!!target.blocked])).digest('hex')
}
export class MediaService {
  private active = new Map<string,Promise<MediaEnrichment>>()
  private queries = new Map<string,Promise<MediaResult>>()
  // Global per-service bound: different owners cannot create unbounded provider concurrency.
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly repo:MediaRepository,private readonly provider:MediaProvider) {}
  async read(owner:string,id:string) { return this.repo.read(await this.repo.snapshot(owner,id)) }
  async resolve(owner:string,id:string,version:string,signal:AbortSignal) {
    const snapshot=await this.repo.snapshot(owner,id)
    if(snapshot.contentVersion!==version)throw new AppError('MEDIA_CONTENT_CHANGED','Guide changed',409)
    signal.throwIfAborted()
    const key=`${owner}:${id}:${version}`,prior=this.active.get(key)
    if(prior)return prior
    const promise=this.perform(snapshot,signal)
    this.active.set(key,promise)
    try{return await promise}finally{if(this.active.get(key)===promise)this.active.delete(key)}
  }
  private async perform(snapshot:PlaceSnapshot,signal:AbortSignal) {
    const targets=await this.repo.targets(snapshot)
    const deadline=Date.now()+24000
    let searches=0
    for(const target of targets){
      signal.throwIfAborted()
      if(Date.now()>=deadline)break
      const key=mediaCacheKey(target)
      let result=await this.repo.cached(key)
      if(!result){
        if(searches++>=12)break
        let query=this.queries.get(key)
        if(!query){
          query=this.queue.then(async()=>{
            signal.throwIfAborted()
            if(Date.now()>=deadline)throw Error('MEDIA_ACTION_DEADLINE')
            const cached=await this.repo.cached(key);if(cached)return cached
            let value:MediaResult
            try{value=await this.provider.search(target,AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(18000,deadline-Date.now())))]))}
            catch{signal.throwIfAborted();value={status:'unavailable',reason:'provider_unavailable',photos:[],checkedAt:new Date().toISOString()}}
            await this.repo.cache(key,value);return value
          })
          this.queue=query.catch(()=>{})
          this.queries.set(key,query)
          void query.finally(()=>{if(this.queries.get(key)===query)this.queries.delete(key)}).catch(()=>{})
        }
        try{result=await query}catch(error){signal.throwIfAborted();if(Date.now()>=deadline)break;throw error}
      }
      signal.throwIfAborted()
      await this.repo.save(snapshot,target.hint.activityId,result,signal)
    }
    const current=await this.repo.snapshot(snapshot.ownerId,snapshot.artifact.id)
    if(current.contentVersion!==snapshot.contentVersion)throw new AppError('MEDIA_CONTENT_CHANGED','Guide changed',409)
    return this.repo.read(current)
  }
}
