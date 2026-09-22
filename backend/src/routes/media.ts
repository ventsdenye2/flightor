import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app/context.js'
import { authenticateRequest } from '../auth/service.js'
import { AppError } from '../lib/errors.js'
import { MediaService } from '../media/service.js'
import { PostgresMediaRepository } from '../media/postgres.js'
import { WikimediaMediaProvider } from '../media/wikimedia.js'
import { createMediaRead } from '../media/transport.js'
export async function registerMediaRoutes(app:FastifyInstance,context:AppContext){
  const service=context.media??new MediaService(new PostgresMediaRepository(context.db),new WikimediaMediaProvider(createMediaRead(context.env.MEDIA_USER_AGENT,context.env.MEDIA_PROXY_URL)))
  context.media=service
  app.get('/v1/artifacts/:id/media',async(request,reply)=>{
    const identity=await authenticateRequest(request,context),{id}=z.object({id:z.string().uuid()}).parse(request.params)
    return reply.header('Cache-Control','no-store').send({enrichment:await service.read(identity.userId,id)})
  })
  app.post('/v1/artifacts/:id/media',{config:{rateLimit:{max:3,timeWindow:'1 minute'}}},async(request,reply)=>{
    const identity=await authenticateRequest(request,context),{id}=z.object({id:z.string().uuid()}).parse(request.params)
    const {contentVersion}=z.object({contentVersion:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(request.body)
    if(!context.env.MEDIA_USER_AGENT)throw new AppError('MEDIA_NOT_CONFIGURED','Media service is not configured',503)
    const controller=new AbortController(),abort=()=>{if(!reply.raw.writableEnded)controller.abort()}
    request.raw.once('aborted',abort);reply.raw.once('close',abort)
    try{return reply.header('Cache-Control','no-store').send({enrichment:await service.resolve(identity.userId,id,contentVersion,controller.signal)})}
    finally{request.raw.off('aborted',abort);reply.raw.off('close',abort)}
  })
}
