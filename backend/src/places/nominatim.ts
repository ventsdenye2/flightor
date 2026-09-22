import { setTimeout as delay } from 'node:timers/promises'
import type { Place, PlaceHint, PlaceProvider, PlaceResolution } from './types.js'
import { placeSchema } from './types.js'

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
  constructor(private readonly options: {baseUrl:string;userAgent:string;fetch?:typeof fetch;reserve?: (signal:AbortSignal)=>Promise<(outcome?:string)=>Promise<void>>}) {}
  search(hint: PlaceHint, signal: AbortSignal): Promise<PlaceResolution> {
    const run = this.tail.catch(()=>{}).then(()=>this.perform(hint,signal));this.tail=run;return run
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
      const response=await(this.options.fetch??fetch)(url,{headers:{'User-Agent':this.options.userAgent,Accept:'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),redirect:'error'})
      if(!response.ok)throw new Error(`place_http_${response.status}`)
      const body=await response.text();if(body.length>200000)throw new Error('place_response_too_large')
      const result=resolveCandidates(JSON.parse(body),hint);outcome=result.status;return result
    } catch(error){outcome=signal.aborted?'cancelled':error instanceof Error&&error.name==='TimeoutError'?'timeout':'provider_failure';throw error}
    finally {await release?.(outcome)}
  }
}
