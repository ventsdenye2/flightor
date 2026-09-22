import { request } from '../utils/request'
import type { ArtifactEnvelope } from './artifactService'
type Enrichment=NonNullable<ArtifactEnvelope['enrichment']>
export async function readMediaEnrichment(id:string) {
  return (await request<{enrichment:Enrichment}>({url:`/v1/artifacts/${encodeURIComponent(id)}/media`,retry:0,showError:false})).enrichment
}
export async function resolveMediaEnrichment(id:string,contentVersion:string) {
  return (await request<{enrichment:Enrichment}>({url:`/v1/artifacts/${encodeURIComponent(id)}/media`,method:'POST',data:{contentVersion},retry:0,timeout:30000,showError:false})).enrichment
}
