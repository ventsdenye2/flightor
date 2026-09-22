import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import https from 'node:https'
import { afterEach,describe,it,expect,vi } from 'vitest'
import { createMediaRead } from './transport.js'
afterEach(()=>vi.restoreAllMocks())
function mock(status=200,type='image/jpeg',body=Buffer.from('body'),slow=false){
  const spy=vi.spyOn(https,'get').mockImplementation(((_url:any,_options:any,callback:any)=>{
    const req=new EventEmitter() as any
    req.destroy=()=>req.emit('close')
    if(!slow)queueMicrotask(()=>{const res=new PassThrough() as any;res.statusCode=status;res.headers={'content-type':type};callback(res);res.end(body)})
    return req
  }) as any)
  return spy
}
describe('media fixed-host bounded transport',()=>{
 const read=()=>createMediaRead('FlightOR test','http://127.0.0.1:7890')
 it('rejects private, arbitrary, credential and wrong-purpose URLs before network',async()=>{const spy=mock();for(const url of ['http://thumb.wikimedia.org/a','https://127.0.0.1/a','https://example.com/a','https://user:password@thumb.wikimedia.org/a','https://en.wikipedia.org/a'])await expect(read()(url,'image',new AbortController().signal)).rejects.toThrow();expect(spy).not.toHaveBeenCalled()})
 it('rejects redirects and non-image content without retries',async()=>{let spy=mock(302);await expect(read()('https://thumb.wikimedia.org/a','image',new AbortController().signal)).rejects.toThrow();expect(spy).toHaveBeenCalledTimes(1);vi.restoreAllMocks();spy=mock(200,'text/html');await expect(read()('https://thumb.wikimedia.org/a','image',new AbortController().signal)).rejects.toThrow();expect(spy).toHaveBeenCalledTimes(1)})
 it('limits actual bytes',async()=>{mock(200,'image/jpeg',Buffer.alloc(2500001));await expect(read()('https://thumb.wikimedia.org/a','image',new AbortController().signal)).rejects.toThrow('MEDIA_SIZE_LIMIT')})
 it('cancels a slow request without changing global fetch',async()=>{const spy=mock(200,'image/jpeg',Buffer.alloc(0),true),original=globalThis.fetch;const abort=new AbortController();const pending=read()('https://thumb.wikimedia.org/a','image',abort.signal);abort.abort(Error('cancelled'));await expect(pending).rejects.toThrow('cancelled');expect(spy).toHaveBeenCalledTimes(1);expect(globalThis.fetch).toBe(original)})
})
