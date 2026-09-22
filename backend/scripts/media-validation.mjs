// Isolated fixture trip/text, preserved real POIs, production media API/DB/provider.
import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import { sql } from 'kysely'
import { setup } from './places-test-support.mjs'
import { up } from '../dist/db/migrations/014_place_media.js'
import { PostgresPlaceRepository } from '../dist/places/postgres.js'
import { registerMediaRoutes } from '../dist/routes/media.js'
import { MediaService } from '../dist/media/service.js'
import { PostgresMediaRepository } from '../dist/media/postgres.js'
import { WikimediaMediaProvider } from '../dist/media/wikimedia.js'
import { createMediaRead } from '../dist/media/transport.js'
import { issueAccessToken } from '../dist/auth/tokens.js'
const directory=path.resolve('backend/.demo/place-media');fs.mkdirSync(directory,{recursive:true})
const manifestFile=path.join(directory,'validation.json')
const manifest=fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{schema:`places_test_${Date.now()}`,requests:[],knownCostUsd:0,scope:'New isolated fixture trip/text via normal Artifact repository; preserved real POI identity; real Wikimedia requests; no Planner'}
const persist=()=>fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));persist()
const h=await setup(manifest.schema)
const exists=await sql`select to_regclass('guide_media_bindings') as name`.execute(h.db);if(!exists.rows[0].name)await up(h.db)
const places=new PostgresPlaceRepository(h.db)
// Read historical real identities, never call Nominatim or change historical records.
const old=await h.admin.query('select artifact_id,activity_id,result_json from places_map_20260922.guide_place_bindings')
for(const e of h.entries){const snapshot=await places.snapshot(h.owner.userId,e.guides.zh.id)
 for(const row of old.rows.filter(r=>r.artifact_id===e.guides.zh.id&&r.result_json.status==='resolved'))await places.save(snapshot,row.activity_id,row.result_json,new AbortController().signal)
}
const env={...h.env,MEDIA_USER_AGENT:'FlightOR/0.1 (https://github.com/ventsdenye2/flightor; bounded place photo validation)',MEDIA_PROXY_URL:process.env.MEDIA_PROXY_URL??''}
const read=createMediaRead(env.MEDIA_USER_AGENT,env.MEDIA_PROXY_URL,entry=>{manifest.requests.push({...entry,at:new Date().toISOString()});persist()})
const provider=new WikimediaMediaProvider(async(...args)=>{
 if(!process.argv.includes('--execute'))throw Error('Live disabled')
 // Free Wikimedia API, temporary validation-only traffic bound, preserves cumulative ledger.
 if(manifest.requests.length>=36)throw Error('Validation traffic bound reached')
 return read(...args)
})
const media=new MediaService(new PostgresMediaRepository(h.db),provider)
const app=Fastify();await registerMediaRoutes(app,{db:h.db,env,redis:undefined,providers:{},media})
app.setErrorHandler((e,req,reply)=>reply.code(e.statusCode??500).send({error:{code:e.code??'MEDIA_ERROR',message:e.message}}))
app.get('/v1/artifacts/:id',async req=>{for(const e of h.entries){const locale=req.query.locale==='en'?'en':'zh';if(e.guides.zh.id===req.params.id)return{artifact:e.guides[locale]};if(e.route.id===req.params.id)return{artifact:e.route};if(e.flight?.id===req.params.id)return{artifact:e.flight}}throw Error('Unknown fixture')})
app.get('/v1/trips/:id/workspace',async req=>h.entries.find(e=>e.workspace.trip.id===req.params.id)?.workspace)
app.get('/v1/artifacts/:id/places',async(req,reply)=>reply.code(503).send({error:{code:'MAP_PAUSED'}}))
app.get('/v1/map-config',async()=>({enabled:false}))
app.get('/fixture/metrics',async()=>({requests:manifest.requests,knownCostUsd:0,schema:manifest.schema}))
const token=await issueAccessToken({...h.owner,localTest:true},env)
fs.writeFileSync(path.join(directory,'transport.json'),JSON.stringify({baseUrl:'http://127.0.0.1:3014',token,entries:h.entries},null,2))
await app.listen({host:'127.0.0.1',port:3014});console.log(JSON.stringify({ready:true,port:3014,schema:manifest.schema,requests:manifest.requests.length}))
async function stop(){await app.close();await h.close();process.exit()};process.on('SIGINT',stop);process.on('SIGTERM',stop)
