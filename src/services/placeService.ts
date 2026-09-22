import { request } from '../utils/request'
import type { ArtifactEnvelope } from './artifactService'
import { recordMapDiagnostic } from '../features/maps/diagnostics'
type Enrichment = NonNullable<ArtifactEnvelope['enrichment']>
export async function readPlaceEnrichment(id:string):Promise<Enrichment|undefined>{
 const started=Date.now()
 recordMapDiagnostic('places','read',null,'pending')
 try {
  const result=await request<{enrichment:Enrichment}>({url:`/v1/artifacts/${encodeURIComponent(id)}/places`,retry:0,showError:false})
  recordMapDiagnostic('places','read',{durationMs:Date.now()-started},'succeeded')
  return result.enrichment
 } catch(error) { recordMapDiagnostic('places','read',error,'failed');throw error }
}
export async function resolvePlaceEnrichment(id:string,contentVersion:string){
 recordMapDiagnostic('places','resolve',null,'pending')
 try {
  const result=await request<{enrichment:Enrichment}>({url:`/v1/artifacts/${encodeURIComponent(id)}/places`,method:'POST',data:{contentVersion},retry:0,timeout:30000})
  recordMapDiagnostic('places','resolve',null,'succeeded');return result
 } catch(error) {recordMapDiagnostic('places','resolve',error,'failed');throw error}
}
