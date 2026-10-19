import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { FlightError } from './errors.js';
import type { DetailsInput, SearchResult } from './types.js';
export class ResultStore {
  constructor(public root:string) {}
  directory(id:string) { return join(this.root,id); }
  async save(result:SearchResult) {
    const dir=this.directory(result.searchId);await mkdir(dir,{recursive:true});
    const destination=join(dir,'result.json');
    await writeFile(`${destination}.tmp`,JSON.stringify(result,null,2));await rename(`${destination}.tmp`,destination);
  }
  async details(input:DetailsInput) {
    let result:SearchResult;
    try { result=JSON.parse(await readFile(join(this.directory(input.searchId),'result.json'),'utf8')); }
    catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT') throw new FlightError('SEARCH_NOT_FOUND','Search ID not found in this tool installation'); throw error; }
    const candidate=result.candidates.find(c=>c.id===input.candidateId);
    if(!candidate) throw new FlightError('CANDIDATE_NOT_FOUND','Candidate does not belong to this search');
    if(!candidate.details) throw new FlightError('DETAILS_UNAVAILABLE','Details were not captured. Run a new search and inspect its warnings.');
    return {schemaVersion:1,status:'complete',source:result.source,quoteType:result.quoteType,searchId:result.searchId,query:result.query,
      snapshot:true,observedAt:result.observedAt,ageSeconds:Math.max(0,Math.floor((Date.now()-Date.parse(result.observedAt))/1000)),
      stale:Date.now()-Date.parse(result.observedAt)>300000,candidate,
      warnings:['This is the saved search snapshot, not a new price check. Run search_flights again for a current quote.']};
  }
}
