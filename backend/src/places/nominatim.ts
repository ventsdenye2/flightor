import { setTimeout as delay } from 'node:timers/promises'
import type { Place, PlaceHint, PlaceProvider, PlaceResolution } from './types.js'
import { placeSchema } from './types.js'
import { createPlaceFetch } from './transport.js'
import { locationResolutionSchema, type LocationRef, type LocationResolution } from '../aviation/types.js'

const normalize = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
export const queryName = (s: string) => s.replace(/\s+(?:neighbou?rhood|cultural area|museum district)$/i, '').trim()
export function unresolvedReason(hint: PlaceHint): string | undefined {
  const names = [hint.name, ...hint.aliases]
  if (!hint.city || !/^[A-Z]{2}$/.test(hint.countryCode)) return 'missing_region'
  if (names.every(n => /street food|local specialties|小吃|美食|特色/i.test(n))) return 'thematic_activity'
  if (names.some(n => /\s+and\s+|与|以及/i.test(n))) return 'multiple_places'
}
function parseCandidate(raw: any, hint: PlaceHint): Place | undefined {
  if (!raw || !['node','way','relation'].includes(raw.osm_type) || !/^\d+$/.test(String(raw.osm_id))) return
  const latitude = Number(raw.lat), longitude = Number(raw.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude === 0 && longitude === 0) return
  const address = raw.address ?? {}, type = String(raw.type), category = String(raw.class ?? raw.category)
  const kind: Place['kind'] | undefined = category === 'aeroway' ? 'airport'
    : ['city','town','administrative'].includes(type) && ['city','municipality','state','region'].includes(raw.addresstype) ? 'city'
      : ['suburb','neighbourhood','quarter','borough'].includes(type) || type==='administrative'&&['suburb','neighbourhood','quarter','borough'].includes(raw.addresstype) ? 'district'
        : category === 'highway'&&['pedestrian','residential','living_street','footway','tertiary','secondary','primary'].includes(type) ? 'street' : ['park','garden','nature_reserve'].includes(type) ? 'park'
          : ['amenity','tourism','historic','building','leisure'].includes(category)&&!['bicycle_rental','parking','toilets','bench','bus_station','taxi'].includes(type) ? 'venue' : undefined
  if (!kind || (hint.scope === 'city' ? kind !== 'city' : kind === 'city' || kind === 'airport')) return
  const aliases = [...new Set([raw.name, ...Object.values(raw.namedetails ?? {}).filter(v => typeof v === 'string')])]
    .filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 300).slice(0,30)
  // Some countries omit the metropolis from addressdetails but retain it as a
  // separate display_name address component (e.g. Tokyo's individual wards).
  const region = [address.city,address.town,address.municipality,address.county,address.state,address.province,...String(raw.display_name??'').split(',').slice(1).map(s=>s.trim())].filter(v=>typeof v==='string')
  if (String(address.country_code).toUpperCase() !== hint.countryCode || !region.some(v => normalize(v)===normalize(hint.city))) return
  const names=[hint.name,...hint.aliases]
  if(names.some(n=>/\b(?:street|avenue|road)$/i.test(n))&&kind!=='street')return
  if(names.some(n=>/\b(?:neighbou?rhood|district|cultural area)$/i.test(n))&&!['district','park'].includes(kind))return
  const expected = [hint.name,...hint.aliases].map(queryName).map(normalize).filter(Boolean)
  const worshipName=(s:string)=>normalize(s.replace(/\b(?:main|shrine)\b/gi,''))
  if (!aliases.some(a => expected.includes(normalize(queryName(a))))) {
    if(type!=='place_of_worship'||!aliases.some(a=>names.some(n=>worshipName(a)===worshipName(n))))return
  }
  const parsed = placeSchema.safeParse({ placeId:`osm:${raw.osm_type}:${raw.osm_id}`,name:aliases[0],aliases,
    city:hint.city,countryCode:hint.countryCode,address:String(raw.display_name ?? '').slice(0,700),kind,coordinates:{latitude,longitude,system:'WGS84'},
    source:{provider:'nominatim',url:`https://www.openstreetmap.org/${raw.osm_type}/${raw.osm_id}`,attribution:'© OpenStreetMap contributors',retrievedAt:new Date().toISOString()} })
  return parsed.success ? parsed.data : undefined
}
export function resolveCandidates(raw: unknown, hint: PlaceHint): PlaceResolution {
  const entries = (Array.isArray(raw) ? raw : []).slice(0,8).filter(r=>r&&typeof r==='object')
  const candidates = entries.map(r=>parseCandidate(r,hint)).filter((p):p is Place=>!!p)
  const unique = [...new Map(candidates.map(p=>[p.placeId,p])).values()]
  const checkedAt = new Date().toISOString()
  // A matching official website or exact OSM entity reference can disambiguate,
  // but cannot bypass name, country, region or entity-granularity checks.
  const canonical=(value:unknown)=>{try{const u=new URL(String(value));return u.protocol==='https:'||u.protocol==='http:'?u.hostname.replace(/^www\./,'')+u.pathname.replace(/\/$/,''):''}catch{return ''}}
  const references=new Set(hint.sourceUrls.map(canonical).filter(Boolean))
  const supported=unique.filter(p=>references.has(canonical(p.source.url))||entries.some(r=>`osm:${r.osm_type}:${r.osm_id}`===p.placeId&&[r.extratags?.website,r.extratags?.['contact:website']].some(v=>references.has(canonical(v)))))
  if(unique.length>1&&supported.length===1)return{status:'resolved',reason:'source_name_and_region_match',place:supported[0]!,checkedAt}
  return unique.length === 1 ? {status:'resolved',reason:'name_and_region_match',place:unique[0]!,checkedAt}
    : {status:unique.length ? 'ambiguous':'unresolved',reason:unique.length ? 'multiple_matching_entities':'no_confirmed_match',
      candidates:unique.map(({placeId,name,kind,city,countryCode})=>({placeId,name,kind,city,countryCode})),checkedAt}
}
/** One explicitly selected Nominatim-compatible service, no model and no fallback provider. */
export class NominatimProvider implements PlaceProvider {
  private tail: Promise<unknown> = Promise.resolve()
  private nextAt = 0
  private readonly fetchImpl:typeof fetch
  constructor(private readonly options: {baseUrl:string;userAgent:string;proxyUrl?:string;fetch?:typeof fetch;reserve?: (signal:AbortSignal,cacheReady?:()=>Promise<boolean>)=>Promise<((outcome?:string)=>Promise<void>)|undefined>}) {
    this.fetchImpl=options.fetch??createPlaceFetch(options.proxyUrl??'')
  }
  private schedule<T>(task:()=>Promise<T>):Promise<T> { const run=this.tail.catch(()=>{}).then(task);this.tail=run;return run }
  search(hint: PlaceHint, signal: AbortSignal): Promise<PlaceResolution> { return this.schedule(()=>this.perform(hint,signal)) }

  /** City-only aviation lookup. Results must be OSM city/town address entities. */
  searchCity(query:string,signal:AbortSignal,limit=20,readCache?:()=>Promise<LocationResolution|undefined>):Promise<LocationResolution> {
    return this.schedule(()=>this.performCitySearch(query,signal,limit,readCache))
  }

  private async performCitySearch(query:string,signal:AbortSignal,limit:number,readCache?:()=>Promise<LocationResolution|undefined>):Promise<LocationResolution> {
    signal.throwIfAborted()
    const checkedAt=new Date().toISOString(), normalized=query.normalize('NFKC').trim().replace(/\s+/g,' ')
    const empty=()=>locationResolutionSchema.parse({matches:[],verification:{status:'unverified',checkedAt,confidence:0,sources:[{provider:'nominatim',...(normalized?{reference:normalized.slice(0,500)}:{})}]}})
    if(normalized.length<2 || !this.options.baseUrl || !this.options.userAgent)return empty()
    const wait=Math.max(0,this.nextAt-Date.now());if(wait)await delay(wait,undefined,{signal})
    let release=await this.options.reserve?.(signal,readCache?async()=>Boolean(await readCache()):undefined)
    let outcome='cancelled'
    try {
      signal.throwIfAborted()
      let cached=await readCache?.()
      signal.throwIfAborted()
      if(!cached&&!release&&this.options.reserve){
        release=await this.options.reserve(signal)
        cached=await readCache?.()
        signal.throwIfAborted()
      }
      if(cached){outcome='cache_hit';return locationResolutionSchema.parse(cached)}
      this.nextAt=Date.now()+1100
      const url=new URL('search',this.options.baseUrl.endsWith('/')?this.options.baseUrl:this.options.baseUrl+'/')
      url.search=new URLSearchParams({q:normalized,featureType:'city',layer:'address',format:'jsonv2',addressdetails:'1',namedetails:'1',limit:String(Math.max(1,Math.min(limit,20))),'accept-language':'en'}).toString()
      const response=await this.fetchImpl(url,{headers:{'User-Agent':this.options.userAgent,Accept:'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),redirect:'error'})
      if(!response.ok)throw new Error(`place_http_${response.status}`)
      const body=await response.text();if(body.length>200000)throw new Error('place_response_too_large')
      const raw=JSON.parse(body), queryParts=normalized.split(',').map(part=>part.trim()).filter(Boolean)
      const matches=(Array.isArray(raw)?raw:[]).slice(0,20).map(value=>parseCityCandidate(value,queryParts[0]??normalized,queryParts.slice(1))).filter((place):place is LocationRef=>!!place)
      const unique=[...new Map(matches.map(place=>[place.id,place])).values()].slice(0,Math.max(1,Math.min(limit,20)))
      const result=locationResolutionSchema.parse({matches:unique,verification:{status:unique.length?'verified':'unverified',checkedAt:new Date().toISOString(),confidence:unique.length?0.9:0,sources:[{provider:'nominatim',reference:normalized.slice(0,500)}]}})
      outcome=result.verification.status
      return result
    } catch(error){outcome=signal.aborted?'cancelled':error instanceof Error&&error.name==='TimeoutError'?'timeout':'provider_failure';throw error}
    finally {await release?.(outcome)}
  }
  private async perform(hint:PlaceHint,signal:AbortSignal):Promise<PlaceResolution> {
    signal.throwIfAborted()
    const reason=unresolvedReason(hint)
    if(reason)return{status:'unresolved',reason,checkedAt:new Date().toISOString()}
    if(!this.options.baseUrl || !this.options.userAgent)return{status:'unavailable',reason:'not_configured',checkedAt:new Date().toISOString()}
    const wait=Math.max(0,this.nextAt-Date.now());if(wait)await delay(wait,undefined,{signal})
    const release=await this.options.reserve?.(signal)
    let outcome='cancelled'
    try {
      signal.throwIfAborted();this.nextAt=Date.now()+1100
      const names=[hint.name,...hint.aliases]
      const name=queryName(names.find(n=>/^[\x20-\x7e]+$/.test(n)) ?? hint.name)
      const url=new URL('search',this.options.baseUrl.endsWith('/')?this.options.baseUrl:this.options.baseUrl+'/')
      url.search=new URLSearchParams({q:hint.scope==='city'?name:`${name}, ${hint.city}`,...(hint.scope==='city'?{featureType:'city',layer:'address'}:{}),countrycodes:hint.countryCode.toLowerCase(),format:'jsonv2',addressdetails:'1',namedetails:'1',extratags:'1',limit:'8','accept-language':'en'}).toString()
      const response=await this.fetchImpl(url,{headers:{'User-Agent':this.options.userAgent,Accept:'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),redirect:'error'})
      if(!response.ok)throw new Error(`place_http_${response.status}`)
      const body=await response.text();if(body.length>200000)throw new Error('place_response_too_large')
      const result=resolveCandidates(JSON.parse(body),hint);outcome=result.status;return result
    } catch(error){outcome=signal.aborted?'cancelled':error instanceof Error&&error.name==='TimeoutError'?'timeout':'provider_failure';throw error}
    finally {await release?.(outcome)}
  }
}

function parseCityCandidate(raw:any,query:string,qualifiers:string[]):LocationRef|undefined {
  if(!raw||!['node','way','relation'].includes(raw.osm_type)||!/^\d+$/.test(String(raw.osm_id)))return
  const type=String(raw.type),addresstype=String(raw.addresstype)
  const placeCity=raw.class==='place'&&['city','town'].includes(type)
  const administrativeCity=raw.class==='boundary'&&type==='administrative'
  if((!placeCity&&!administrativeCity)||!['city','town'].includes(addresstype))return
  const name=typeof raw.name==='string'?raw.name.trim():''
  const names=[name,...Object.values(raw.namedetails??{}).filter((value):value is string=>typeof value==='string')]
  if(!names.some(value=>normalize(value)===normalize(query)))return
  const countryCode=typeof raw.address?.country_code==='string'?raw.address.country_code.toUpperCase():''
  const address=raw.address&&typeof raw.address==='object'?raw.address:{}
  const administrativeValues=['country','country_code','state','state_district','province','region','county','municipality','city','town','city_district','borough','suburb','village','hamlet']
    .map(key=>address[key]).filter((value):value is string=>typeof value==='string').map(normalize)
  if(qualifiers.some(qualifier=>!administrativeValues.includes(normalize(qualifier))))return
  const latitude=Number(raw.lat),longitude=Number(raw.lon)
  if(!name||name.length>160||! /^[A-Z]{2}$/.test(countryCode)||!Number.isFinite(latitude)||latitude < -90||latitude>90||!Number.isFinite(longitude)||longitude < -180||longitude>180)return
  return {id:`osm:${raw.osm_type}:${raw.osm_id}`,type:'city',name,countryCode,latitude,longitude}
}
