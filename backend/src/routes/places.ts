import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { authenticateRequest } from '../auth/service.js'
import { AppError } from '../lib/errors.js'
import { PostgresPlaceRepository } from '../places/postgres.js'
import { PlaceService } from '../places/service.js'
import { NominatimProvider } from '../places/nominatim.js'

export async function registerPlaceRoutes(app:FastifyInstance,context:AppContext){
 if(!context.places){const repo=new PostgresPlaceRepository(context.db)
  context.places=new PlaceService(repo,new NominatimProvider({baseUrl:context.env.PLACES_NOMINATIM_URL,userAgent:context.env.PLACES_USER_AGENT,reserve:signal=>repo.reserve(signal)}),`${context.env.PLACES_NOMINATIM_URL}:v1`)
 }
 app.get('/v1/map-config',async()=>({tileUrl:context.env.MAP_TILE_URL,attribution:'© OpenStreetMap contributors',enabled:!!context.env.PLACES_NOMINATIM_URL&&!!context.env.PLACES_USER_AGENT}))
 app.get('/v1/artifacts/:id/places',async(request,reply)=>{
  const identity=await authenticateRequest(request,context)
  const {id}=z.object({id:z.string().uuid()}).strict().parse(request.params)
  const enrichment=await context.places!.read(identity.userId,id)
  return reply.header('Cache-Control','no-store').send({enrichment})
 })
 app.post('/v1/artifacts/:id/places',{config:{rateLimit:{max:3,timeWindow:'1 minute'}}},async(request,reply)=>{
  const identity=await authenticateRequest(request,context)
  const {id}=z.object({id:z.string().uuid()}).strict().parse(request.params)
  const {contentVersion}=z.object({contentVersion:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(request.body)
  if(!context.env.PLACES_NOMINATIM_URL||!context.env.PLACES_USER_AGENT)throw new AppError('PLACE_NOT_CONFIGURED','Place resolution is not configured',503)
  const controller=new AbortController(),abort=()=>{if(!reply.raw.writableEnded)controller.abort()}
  request.raw.once('aborted',abort);reply.raw.once('close',abort)
  try {const enrichment=await context.places!.resolve(identity.userId,id,contentVersion,controller.signal)
   return reply.header('Cache-Control','no-store').send({enrichment})
  }finally{request.raw.off('aborted',abort);reply.raw.off('close',abort)}
 })
}
