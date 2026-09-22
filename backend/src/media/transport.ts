import https from 'node:https'
import { promises as dns } from 'node:dns'
import { ipv4IsPublic } from '../research-agent/source-reader.js'
import type { MediaRead } from './wikimedia.js'

const hosts = new Set(['en.wikipedia.org','ja.wikipedia.org','zh.wikipedia.org','commons.wikimedia.org','upload.wikimedia.org','thumb.wikimedia.org'])
/** Fixed Wikimedia destinations, bounded GET bytes, TLS verification, no redirects. */
export function createMediaRead(userAgent: string, proxyUrl = '', observe?: (entry: { host:string;kind:string;status:number|null;bytes:number;ok:boolean }) => void): MediaRead {
  if (proxyUrl) {
    const u=new URL(proxyUrl); if(!['http:','https:'].includes(u.protocol)||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid MEDIA_PROXY_URL')
    const [major=0,minor=0]=process.versions.node.split('.').map(Number)
    if(!((major===22&&minor>=21)||(major===24&&minor>=5)||major>24))throw Error('Media proxy requires Node 22.21+ or 24.5+')
  }
  return async (input,kind,parent) => {
    const url=new URL(input)
    if(url.protocol!=='https:' || !hosts.has(url.hostname) || url.port || url.username || url.password || (kind==='image')!==(['upload.wikimedia.org','thumb.wikimedia.org'].includes(url.hostname))) throw Error('MEDIA_URL_REJECTED')
    const signal=AbortSignal.any([parent,AbortSignal.timeout(8000)])
    signal.throwIfAborted()
    // With an explicit trusted CONNECT proxy, DNS belongs to that transport.
    // Only these fixed supplier hosts are allowed, never caller-provided URLs.
    const addresses=proxyUrl?[]:await Promise.race([dns.lookup(url.hostname,{all:true,family:4}),new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))])
    signal.throwIfAborted()
    if(!proxyUrl&&(!addresses.length||addresses.some(a=>!ipv4IsPublic(a.address))))throw Error('MEDIA_DNS_REJECTED')
    const options:https.AgentOptions & {proxyEnv?:Record<string,string>}={keepAlive:false,...(proxyUrl?{proxyEnv:{HTTPS_PROXY:proxyUrl,https_proxy:proxyUrl,HTTP_PROXY:proxyUrl,http_proxy:proxyUrl,NO_PROXY:'',no_proxy:''}}:{})}
    const agent=new https.Agent(options)
    let status:number|null=null, size=0, ok=false
    try { return await new Promise<Buffer>((resolve,reject)=>{
      const req=https.get(url,{agent,signal,headers:{'User-Agent':userAgent,Accept:kind==='json'?'application/json':'image/jpeg,image/png,image/webp','Accept-Encoding':'identity'},
        ...(!proxyUrl?{lookup:((_host:unknown,opts:any,cb:any)=>opts?.all?cb(null,[addresses[0]!]):cb(null,addresses[0]!.address,4)) as any}:{})},res=>{
        status=res.statusCode??0
        const type=String(res.headers['content-type']??'').split(';')[0]
        if(status!==200 || (kind==='json'?type!=='application/json':!['image/jpeg','image/png','image/webp'].includes(type!)) || res.headers['content-encoding'] && res.headers['content-encoding']!=='identity') {res.destroy();reject(Error('MEDIA_RESPONSE_REJECTED'));return}
        const chunks:Buffer[]=[]
        res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>(kind==='json'?256000:2500000)){res.destroy(Error('MEDIA_SIZE_LIMIT'));return}chunks.push(chunk)})
        res.once('error',reject);res.once('aborted',()=>reject(Error('MEDIA_ABORTED')))
        res.once('end',()=>{ok=true;resolve(Buffer.concat(chunks))})
      })
      const abort=()=>{req.destroy();reject(signal.reason)}
      signal.addEventListener('abort',abort,{once:true});req.once('close',()=>signal.removeEventListener('abort',abort));req.once('error',reject)
      if(signal.aborted)abort()
    }) } finally { agent.destroy();observe?.({host:url.hostname,kind,status,bytes:size,ok}) }
  }
}
