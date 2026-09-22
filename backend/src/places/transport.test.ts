import {createServer} from 'node:http'
import {once} from 'node:events'
import {describe,it,expect} from 'vitest'
import {createPlaceFetch} from './transport.js'

describe('request-scoped place proxy',()=>{
 it('uses the selected CONNECT proxy without modifying global fetch or retrying',async()=>{
  const server=createServer(),requests:string[]=[]
  server.on('connect',(req,socket)=>{requests.push(req.url!);socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const original=globalThis.fetch
  try{
   const address=server.address() as {port:number}
   const request=createPlaceFetch(`http://127.0.0.1:${address.port}`)
   await expect(request('https://place-test.invalid/search',{signal:AbortSignal.timeout(2000)})).rejects.toThrow()
   expect(requests).toEqual(['place-test.invalid:443']);expect(globalThis.fetch).toBe(original)
  }finally{server.close();await once(server,'close')}
 })
 it('aborts an unresponsive proxy within the caller deadline',async()=>{
  const server=createServer();const sockets=new Set<import('node:net').Socket>()
  server.on('connect',(_req,socket)=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket))})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  try{
   const address=server.address() as {port:number}
   await expect(createPlaceFetch(`http://127.0.0.1:${address.port}`)('https://place-test.invalid/search',{signal:AbortSignal.timeout(100)})).rejects.toThrow()
  }finally{for(const s of sockets)s.destroy();server.close();await once(server,'close')}
 })
 it('rejects non-HTTP proxies and non-HTTPS destinations',async()=>{
  expect(()=>createPlaceFetch('socks5://localhost:7890')).toThrow('Invalid PLACES_PROXY_URL')
  await expect(createPlaceFetch('http://127.0.0.1:7890')('http://place-test.invalid')).rejects.toThrow('requires HTTPS')
 })
})
