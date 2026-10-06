import { describe,it,expect,vi } from 'vitest'
import { NominatimProvider,resolveCandidates,unresolvedReason } from './nominatim.js'
import { PlaceService,type PlaceRepository,type PlaceSnapshot } from './service.js'
import type { PlaceHint,PlaceResolution,PlaceEnrichment } from './types.js'
import type { LocationResolution } from '../aviation/types.js'
const hint:PlaceHint={activityId:'a',name:'Ueno Park',aliases:['上野公园'],city:'Tokyo',countryCode:'JP',sourceUrls:[]}
const candidate=(overrides:Record<string,unknown>={})=>({osm_type:'way',osm_id:123,name:'Ueno Park',namedetails:{'name:en':'Ueno Park'},lat:'35.714',lon:'139.774',class:'leisure',type:'park',address:{city:'Tokyo',country_code:'jp'},...overrides})
const cityCandidate=(overrides:Record<string,unknown>={})=>({osm_type:'relation',osm_id:987,name:'Kyoto',lat:'35.0116',lon:'135.7681',class:'place',type:'city',addresstype:'city',address:{city:'Kyoto',country:'Japan',country_code:'jp'},...overrides})
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
 it('returns only OSM city/town identities with the country and identity from the result',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
   cityCandidate(),
   cityCandidate({osm_type:'node',osm_id:654,name:'Kyoto',type:'town',addresstype:'town'}),
   cityCandidate({osm_id:321,class:'boundary',type:'administrative',addresstype:'town'}),
   cityCandidate({osm_id:999,class:'amenity',type:'town'}),
   cityCandidate({osm_id:1000,address:{}}),
   cityCandidate({osm_type:'',osm_id:1001}),
   cityCandidate({osm_id:1002,name:'Tallinn'}),
   cityCandidate({osm_id:1003,class:'boundary',type:'administrative',addresstype:'county'}),
   cityCandidate({osm_id:1004,address:{city:'Kyoto',country:'China',country_code:'cn'}})
  ])))
  const provider=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org',userAgent:'FlightOR-test',fetch:fetcher})
  const result=await provider.searchCity('Kyoto',new AbortController().signal)
  expect(result.matches).toEqual([
   {id:'osm:relation:987',type:'city',name:'Kyoto',countryCode:'JP',latitude:35.0116,longitude:135.7681},
   {id:'osm:node:654',type:'city',name:'Kyoto',countryCode:'JP',latitude:35.0116,longitude:135.7681},
   {id:'osm:relation:321',type:'city',name:'Kyoto',countryCode:'JP',latitude:35.0116,longitude:135.7681},
   {id:'osm:relation:1004',type:'city',name:'Kyoto',countryCode:'CN',latitude:35.0116,longitude:135.7681}
  ])
  expect(result.verification.status).toBe('verified')
  const url=new URL(String(fetcher.mock.calls[0]?.[0]))
  expect(url.searchParams.get('featureType')).toBe('city')
  expect(url.searchParams.get('layer')).toBe('address')
  expect(url.searchParams.get('q')).toBe('Kyoto')
 })
 it('accepts JSONv2 category fields only when class is absent and preserves city ambiguity',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
   cityCandidate({class:undefined,category:'boundary',type:'administrative',addresstype:'city'}),
   cityCandidate({class:undefined,category:'boundary',type:'administrative',addresstype:'city',osm_type:'node',osm_id:654}),
   cityCandidate({class:'amenity',category:'boundary',type:'administrative',osm_id:655}),
   cityCandidate({class:undefined,category:'boundary',type:'administrative',osm_id:656,name:'Tallinn'})
  ])))
  const provider=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org',userAgent:'FlightOR-test',fetch:fetcher})
  const result=await provider.searchCity('Kyoto',new AbortController().signal)
  expect(result.matches.map(match=>match.id)).toEqual(['osm:relation:987','osm:node:654'])
  expect(result.verification.status).toBe('verified')
 })
 it('requires every explicit comma-delimited city qualifier to match OSM address data',async()=>{
  const valid=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org',userAgent:'FlightOR-test',fetch:vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
   cityCandidate({address:{city:'Kyoto',country:'Japan',country_code:'jp'}})
  ])))})
  await expect(valid.searchCity('Kyoto, Japan',new AbortController().signal)).resolves.toMatchObject({matches:[{id:'osm:relation:987',countryCode:'JP'}]})
  const wrongCountry=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org',userAgent:'FlightOR-test',fetch:vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
   cityCandidate({address:{city:'Kyoto',country:'Japan',country_code:'jp'}})
  ])))})
  await expect(wrongCountry.searchCity('Kyoto, China',new AbortController().signal)).resolves.toMatchObject({matches:[]})
  const validRegion=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org',userAgent:'FlightOR-test',fetch:vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
   cityCandidate({name:'San Jose',address:{city:'San Jose',state:'California',country:'United States',country_code:'us'}})
  ])))})
  await expect(validRegion.searchCity('San Jose, California, United States',new AbortController().signal)).resolves.toMatchObject({matches:[{id:'osm:relation:987',countryCode:'US'}]})
  const wrongRegion=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org',userAgent:'FlightOR-test',fetch:vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
   cityCandidate({name:'San Jose',address:{city:'San Jose',state:'California',country:'United States',country_code:'us'}})
  ])))})
  await expect(wrongRegion.searchCity('San Jose, Texas, United States',new AbortController().signal)).resolves.toMatchObject({matches:[]})
 })
 it('does not invent country or city identity when Nominatim is unconfigured or omits source fields',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([cityCandidate({address:{}})])))
  const unconfigured=await new NominatimProvider({baseUrl:'',userAgent:'',fetch:fetcher}).searchCity('Tallinn',new AbortController().signal)
  expect(unconfigured).toMatchObject({matches:[],verification:{status:'unverified',confidence:0}})
  expect(fetcher).not.toHaveBeenCalled()
  const configured=await new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org',userAgent:'FlightOR-test',fetch:fetcher}).searchCity('Tallinn',new AbortController().signal)
  expect(configured.matches).toEqual([])
 })
 it('rechecks the shared cache after the provider lease is obtained and propagates cancellation',async()=>{
  const fetcher=vi.fn<typeof fetch>()
  let outcome=''
  const provider=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org',userAgent:'FlightOR-test',fetch:fetcher,
   reserve:async()=>async(value)=>{outcome=value}})
  const cached:LocationResolution={matches:[{id:'osm:node:45',type:'city',name:'Tallinn',countryCode:'EE'}],verification:{status:'verified',checkedAt:new Date().toISOString(),confidence:1,sources:[{provider:'nominatim'}]}}
  const result=await provider.searchCity('Tallinn',new AbortController().signal,20,async()=>cached)
  expect(result).toEqual(cached)
  expect(outcome).toBe('cache_hit')
  expect(fetcher).not.toHaveBeenCalled()
  const controller=new AbortController();controller.abort()
  await expect(provider.searchCity('Kyoto',controller.signal)).rejects.toMatchObject({name:'AbortError'})
 })
 it('lets the shared lease poll the cache while waiting so cached work does not reserve a provider call',async()=>{
  const fetcher=vi.fn<typeof fetch>(),cached:LocationResolution={matches:[],verification:{status:'verified',checkedAt:new Date().toISOString(),confidence:1,sources:[{provider:'nominatim'}]}}
  const reserve=vi.fn(async(_signal:AbortSignal,cacheReady?:()=>Promise<boolean>)=>{
   expect(cacheReady).toBeTypeOf('function');expect(await cacheReady?.()).toBe(true);return undefined
  })
  const provider=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org',userAgent:'FlightOR-test',fetch:fetcher,reserve})
  await expect(provider.searchCity('Tallinn',new AbortController().signal,20,async()=>cached)).resolves.toEqual(cached)
  expect(reserve).toHaveBeenCalledOnce();expect(fetcher).not.toHaveBeenCalled()
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
