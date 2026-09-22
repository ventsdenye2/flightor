import { request } from '../utils/request'
import type { ArtifactEnvelope } from './artifactService'
type Enrichment = NonNullable<ArtifactEnvelope['enrichment']>
export async function readPlaceEnrichment(id:string):Promise<Enrichment|undefined>{
 const result=await request<{enrichment:Enrichment}>({url:`/v1/artifacts/${encodeURIComponent(id)}/places`,retry:0,showError:false})
 return result.enrichment
}
export async function resolvePlaceEnrichment(id:string,contentVersion:string){
 return request<{enrichment:Enrichment}>({url:`/v1/artifacts/${encodeURIComponent(id)}/places`,method:'POST',data:{contentVersion},retry:0,timeout:30000})
}
