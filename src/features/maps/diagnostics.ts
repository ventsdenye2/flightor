import { diagnosticDetail } from '../../components/place-map/diagnostic-detail'
export function recordMapDiagnostic(layer:string,stage:string,detail:unknown=null,status='observed') {
 const root=globalThis as typeof globalThis & {__FLIGHTOR_MAP_DIAGNOSTICS__?:unknown[]}
 const entries=root.__FLIGHTOR_MAP_DIAGNOSTICS__??=[]
 entries.push({at:new Date().toISOString(),layer,stage,status,...diagnosticDetail(detail)})
 if(entries.length>150)entries.splice(0,entries.length-150)
}
