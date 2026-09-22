import { describe,it,expect,vi } from 'vitest'
import { NominatimProvider,resolveCandidates,unresolvedReason } from './nominatim.js'
import { PlaceService,type PlaceRepository,type PlaceSnapshot } from './service.js'
import type { PlaceHint,PlaceResolution,PlaceEnrichment } from './types.js'
const hint:PlaceHint={activityId:'a',name:'Ueno Park',aliases:['上野公园'],city:'Tokyo',countryCode:'JP',sourceUrls:[]}
const candidate=(overrides:Record<string,unknown>={})=>({osm_type:'way',osm_id:123,name:'Ueno Park',namedetails:{'name:en':'Ueno Park'},lat:'35.714',lon:'139.774',class:'leisure',type:'park',address:{city:'Tokyo',country_code:'jp'},...overrides})
describe('place identity without model inference',()=>{
 it('matches Tokyo venues by name, country and region; never city/airport coordinates',()=>{
  expect(resolveCandidates([candidate()],hint).place).toMatchObject({placeId:'osm:way:123',kind:'park',coordinates:{system:'WGS84',latitude:35.714}})
  for(const c of [candidate({address:{city:'Kyoto',country_code:'jp'}}),candidate({address:{city:'Tokyo',country_code:'cn'}}),candidate({class:'aeroway'}),candidate({class:'place',type:'city',addresstype:'city'}),candidate({lat:'0',lon:'0'})])expect(resolveCandidates([c],hint).status).toBe('unresolved')
 })
 it('does not choose the first duplicate name; preserves neighborhood granularity',()=>{
  expect(resolveCandidates([candidate(),candidate({osm_id:456})],hint).status).toBe('ambiguous')
  expect(resolveCandidates([candidate({name:'Kuramae',namedetails:{'name:en':'Kuramae'},class:'place',type:'suburb'})],{...hint,name:'Kuramae neighborhood',aliases:[]}).place?.kind).toBe('district')
 })
 it('refuses generic food and composite activities before a query',()=>{
  expect(unresolvedReason({...hint,name:'Tokyo street food',aliases:[]})).toBe('thematic_activity')
  expect(unresolvedReason({...hint,name:'Temple and Market',aliases:[]})).toBe('multiple_places')
  expect(unresolvedReason({...hint,name:'Takeshita Street',aliases:['原宿竹下通街头小吃']})).toBeUndefined()
 })
 it('uses an exact official source to disambiguate only within matching region and name',()=>{
  const other=candidate({osm_id:456,extratags:{website:'https://park.example/official'}})
  expect(resolveCandidates([candidate(),other],{...hint,sourceUrls:['https://park.example/official/']}).place?.placeId).toBe('osm:way:456')
  expect(resolveCandidates([candidate(),other],{...hint,sourceUrls:['https://unrelated.example/']}).status).toBe('ambiguous')
 })
 it('recognizes metropolis address components and administrative districts, excluding station and rental namesakes',()=>{
  const ward={city:'Taito',country_code:'jp'}
  const district=candidate({class:undefined,category:'boundary',type:'administrative',addresstype:'neighbourhood',address:ward,display_name:'Ueno Park, Taito, Tokyo, Japan'})
  const streetStop=candidate({class:'highway',type:'bus_stop',address:ward,display_name:'Ueno Park, Taito, Tokyo, Japan'})
  const rental=candidate({class:'amenity',type:'bicycle_rental',address:ward,display_name:'Ueno Park, Taito, Tokyo, Japan'})
  expect(resolveCandidates([district,streetStop,rental],{...hint,name:'Ueno Park cultural area'}).place?.kind).toBe('district')
  expect(resolveCandidates([district],{...hint,city:'Kyoto'}).status).toBe('unresolved')
 })
 it('requires the requested street granularity, while leaving two different matching streets ambiguous',()=>{
  const street=candidate({name:'Takeshita Street',namedetails:{},class:'highway',type:'pedestrian'})
  const point=candidate({name:'Takeshita Street',namedetails:{},class:'tourism',type:'attraction',osm_id:2})
  const h={...hint,name:'Takeshita Street',aliases:[]}
  expect(resolveCandidates([point,street],h).place?.kind).toBe('street')
  expect(resolveCandidates([street,{...street,osm_id:3}],h).status).toBe('ambiguous')
 })
 it('bounds HTTP and does not expose a key or send tools/user preferences',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([candidate()])))
  const provider=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org/',userAgent:'FlightOR-test',fetch:fetcher})
  expect((await provider.search(hint,new AbortController().signal)).status).toBe('resolved')
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('countrycodes=jp')
  expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({'User-Agent':'FlightOR-test'})
 })
})
function harness(){
 let current='a'.repeat(64),owner='owner'
 let sourceUrls=hint.sourceUrls
 const values:PlaceEnrichment={contentVersion:current,activities:{}}
 const cache=new Map<string,PlaceResolution>()
 const snapshot=async(o:string):Promise<PlaceSnapshot>=>{if(o!==owner)throw Error('owner');return{ownerId:o,artifact:{id:'guide',tripId:'trip'} as any,contentVersion:current,hints:[{...hint,sourceUrls},{...hint,sourceUrls,activityId:'b'}]}}
 const repo:PlaceRepository={snapshot,read:async()=>structuredClone(values),save:async(s,id,r,signal)=>{signal.throwIfAborted();if(s.contentVersion!==current)throw Error('stale');values.activities[id]={place:r}},cached:async k=>cache.get(k),cache:async(k,r)=>{cache.set(k,r);return r}}
 const search=vi.fn(async()=>resolveCandidates([candidate()],hint))
 const service=new PlaceService(repo,{search},'test')
 return{service,search,values,change:()=>{current='b'.repeat(64)},owner:()=>{owner='other'},sources:(urls:string[])=>{sourceUrls=urls;values.activities={}}}
}
describe('published place extension boundaries',()=>{
 it('does not reuse an evidence-based identity decision for different source evidence',async()=>{
  const h=harness(),signal=new AbortController().signal,version='a'.repeat(64)
  await h.service.resolve('owner','guide',version,signal)
  h.sources(['https://different-official.example/venue'])
  await h.service.resolve('owner','guide',version,signal)
  expect(h.search).toHaveBeenCalledTimes(2)
 })
 it('coalesces concurrent requests, shares duplicate places and never queries on read/refresh/locale changes',async()=>{
  const h=harness(),signal=new AbortController().signal,version='a'.repeat(64)
  await Promise.all([h.service.resolve('owner','guide',version,signal),h.service.resolve('owner','guide',version,signal)])
  expect(h.search).toHaveBeenCalledTimes(1)
  expect(h.values.activities.a?.place.place?.placeId).toBe(h.values.activities.b?.place.place?.placeId)
  await h.service.read('owner','guide');await h.service.resolve('owner','guide',version,signal)
  expect(h.search).toHaveBeenCalledTimes(1)
 })
 it('rejects owner and content changes before querying',async()=>{
  const h=harness();await expect(h.service.resolve('other','guide','a'.repeat(64),new AbortController().signal)).rejects.toThrow('owner')
  h.change();await expect(h.service.resolve('owner','guide','a'.repeat(64),new AbortController().signal)).rejects.toThrow('changed');expect(h.search).not.toHaveBeenCalled()
 })
 it('never stores a late response after a content change or cancellation',async()=>{
  for(const cancel of [true,false]){const h=harness(),controller=new AbortController()
   h.search.mockImplementationOnce(async()=>{if(cancel)controller.abort();else h.change();return resolveCandidates([candidate()],hint)})
   await expect(h.service.resolve('owner','guide','a'.repeat(64),controller.signal)).rejects.toThrow();expect(h.values.activities).toEqual({})
  }
 })
 it('records technical failure without replacing the text or looping',async()=>{
  const h=harness();h.search.mockRejectedValue(Error('network'))
  const result=await h.service.resolve('owner','guide','a'.repeat(64),new AbortController().signal)
  expect(result.activities.a?.place.status).toBe('unavailable');expect(h.search).toHaveBeenCalledTimes(1)
 })
})
