// Explicitly authorized small live POI validation. No Planner, research, model or image calls.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import https from 'node:https'
import { createRequire } from 'node:module'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { sql } from 'kysely'
import { setup } from './places-test-support.mjs'
import { PostgresPlaceRepository } from '../dist/places/postgres.js'
import { PlaceService } from '../dist/places/service.js'
import { NominatimProvider } from '../dist/places/nominatim.js'
import { registerPlaceRoutes } from '../dist/routes/places.js'
import { issueAccessToken } from '../dist/auth/tokens.js'
import { PostgresArtifactRepository } from '../dist/artifacts/postgres.js'
const directory=path.resolve('backend/.demo/places-map-20260922')
fs.mkdirSync(directory,{recursive:true})
// Renew only the isolated harness identity; never change production auth or POI records.
if(process.argv.includes('--refresh-token')){
 const h=await setup('places_map_20260922'),transportFile=path.join(directory,'transport.json')
 const saved=JSON.parse(fs.readFileSync(transportFile,'utf8'))
 saved.token=await issueAccessToken({...h.owner,localTest:true},h.env)
 fs.writeFileSync(transportFile,JSON.stringify(saved,null,2));await h.close()
 console.log('Refreshed isolated validation token; no provider calls');process.exit(0)
}
const execute=process.argv.includes('--execute'),file=path.join(directory,'ledger.json'),lock=path.join(directory,'ledger.lock')
const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid))
const ledger=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,authorization:'User authorized OSM Nominatim, at most 24 free calls on 2026-09-22',limit:24,calls:[]}
if(ledger.version!==1||!(ledger.limit===24||(ledger.limit===null&&ledger.unlimitedPlaceCalls===true))||!Array.isArray(ledger.calls))throw Error('Invalid existing ledger')
const save=()=>fs.writeFileSync(file,JSON.stringify(ledger,null,2))
save()
// Reuse this workstation's existing proxy, only in the live validation harness.
const require=createRequire(import.meta.url)
const agent=process.env.HTTPS_PROXY?new(require('../../node_modules/https-proxy-agent').HttpsProxyAgent)(process.env.HTTPS_PROXY):undefined
const transport=(url,init)=>agent?new Promise((resolve,reject)=>{
 const request=https.get(url,{agent,headers:init.headers,signal:init.signal},response=>{
  const chunks=[];let size=0
  response.on('data',chunk=>{size+=chunk.length;if(size>200000)request.destroy(Error('Response too large'));else chunks.push(chunk)})
  response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:{'content-type':'application/json'}})))
  response.on('error',reject)
 });request.on('error',reject)
}):fetch(url,init)
const h=await setup('places_map_20260922'),repo=new PostgresPlaceRepository(h.db)
// Final acceptance copies keep original failed/debug records. Stable activity IDs,
// trip, flight, content hash and accepted bilingual text are unchanged.
if(process.argv.includes('--acceptance')){
 const artifacts=new PostgresArtifactRepository(h.db,h.owner.userId)
 for(const entry of h.entries){const oldId=entry.guides.zh.id,newId=`20260922${oldId.slice(8)}`
  if(!await artifacts.get(newId)){const old=await artifacts.get(oldId),payload=structuredClone(old.payload);payload.publication.artifactId=newId
   await artifacts.create({id:newId,tripId:old.tripId,tripContextVersion:old.tripContextVersion,type:'travel_guide',schemaVersion:1,payload})}
  for(const guide of Object.values(entry.guides)){guide.id=newId;guide.payload.publication.artifactId=newId}
  entry.workspace.artifactRefs=entry.workspace.artifactRefs.map(r=>r.id===oldId?{...r,id:newId}:r)
 }
}
// Copy only existing reference airports (never fixture/city coordinates), read-only source.
await sql`insert into countries(code,name_zh,name_en) select code,name_zh,name_en from public.countries where code in ('CN','JP') on conflict do nothing`.execute(h.db)
await sql`insert into airports(iata_code,name_zh,name_en,country_code,latitude,longitude,active) select iata_code,name_zh,name_en,country_code,latitude,longitude,active from public.airports where iata_code in ('PEK','HND','NRT') on conflict do nothing`.execute(h.db)
const provider=new NominatimProvider({baseUrl:h.env.PLACES_NOMINATIM_URL,userAgent:h.env.PLACES_USER_AGENT,reserve:s=>repo.reserve(s),fetch:async(url,init)=>{
 if(!execute)throw Error('Live calls disabled: pass --execute under existing authorization')
 const u=new URL(url);if(u.origin!=='https://nominatim.openstreetmap.org'||u.pathname!=='/search')throw Error('Only selected POI endpoint allowed')
 if((ledger.limit!==null&&ledger.calls.length>=ledger.limit))throw Error('PLACE_CALL_LIMIT')
 const call={number:ledger.calls.length+1,url:u.href,startedAt:new Date().toISOString(),status:'reserved',costUsd:0};ledger.calls.push(call);save()
 try{const r=await transport(url,init),body=await r.text();call.status=String(r.status);call.finishedAt=new Date().toISOString();call.responseHash=createHash('sha256').update(body).digest('hex');fs.writeFileSync(path.join(directory,`response-${call.number}.json`),body);save();return new Response(body,{status:r.status,headers:r.headers})}
 catch(e){call.status='failed';call.failure=String(e);call.finishedAt=new Date().toISOString();save();throw e}
}})
const context={db:h.db,env:h.env,places:new PlaceService(repo,provider,`${h.env.PLACES_NOMINATIM_URL}:v1`)}
const app=Fastify();await app.register(cors,{origin:true})
app.setErrorHandler((e,req,reply)=>reply.code(e.statusCode??(e.name==='ZodError'?400:500)).send({error:{code:e.code??'PLACE_ERROR',message:e.message}}))
await registerPlaceRoutes(app,context)
// Transport fixtures only. Place routes above are the real authenticated production handlers.
app.get('/v1/artifacts/:id',async req=>{for(const e of h.entries){const locale=req.query.locale==='en'?'en':'zh';if(e.guides.zh.id===req.params.id)return{artifact:e.guides[locale]};if(e.route.id===req.params.id)return{artifact:e.route};if(e.flight?.id===req.params.id)return{artifact:e.flight}}throw Error('Fixture not found')})
app.get('/v1/trips/:id/workspace',async req=>h.entries.find(e=>e.workspace.trip.id===req.params.id)?.workspace)
const token=await issueAccessToken({...h.owner,localTest:true},h.env)
fs.writeFileSync(path.join(directory,'transport.json'),JSON.stringify({baseUrl:'http://127.0.0.1:3013',token,entries:h.entries},null,2))
app.get('/fixture/metrics',async()=>({calls:ledger.calls.length,limit:ledger.limit,identities:await sql`select activity_id,result_json from guide_place_bindings order by artifact_id,activity_id`.execute(h.db).then(r=>r.rows)}))
await app.listen({host:'127.0.0.1',port:3013})
console.log(JSON.stringify({ready:true,port:3013,scope:'Synthetic trip/text, real authenticated place API + PostgreSQL + Nominatim',execute,calls:ledger.calls.length,directory}))
async function stop(){await app.close();await h.close();fs.closeSync(fd);fs.unlinkSync(lock);process.exit()}
process.on('SIGINT',stop);process.on('SIGTERM',stop)
