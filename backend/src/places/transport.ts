import https from 'node:https'

/** A dedicated agent for this request only; never changes global fetch/agents. */
export function createPlaceFetch(proxyUrl: string): typeof fetch {
  if (!proxyUrl) return (input, init) => fetch(input, init)
  const proxy=new URL(proxyUrl)
  if(!['http:','https:'].includes(proxy.protocol)||proxy.pathname!=='/'||proxy.search||proxy.hash)throw new Error('Invalid PLACES_PROXY_URL')
  const [major=0,minor=0]=process.versions.node.split('.').map(Number)
  if(!((major===22&&minor>=21)||(major===24&&minor>=5)||major>24))throw new Error('Place proxy requires Node 22.21+ or 24.5+')
  return async (input,init)=>{
    if(input instanceof Request)throw new Error('Place transport expects URL input')
    const url=new URL(input)
    if(url.protocol!=='https:'||url.username||url.password)throw new Error('Place transport requires HTTPS')
    if(init?.method&&init.method!=='GET'||init?.body)throw new Error('Place transport is GET-only')
    init?.signal?.throwIfAborted()
    const options:https.AgentOptions & {proxyEnv:Record<string,string>}={keepAlive:false,timeout:8000,proxyEnv:{HTTPS_PROXY:proxyUrl,https_proxy:proxyUrl,HTTP_PROXY:proxyUrl,http_proxy:proxyUrl,NO_PROXY:'',no_proxy:''}}
    const agent=new https.Agent(options)
    let abort:(()=>void)|undefined
    try{return await new Promise<Response>((resolve,reject)=>{
      const headers:Record<string,string>={};new Headers(init?.headers).forEach((value,key)=>{headers[key]=value})
      const req=https.get(url,{agent,headers,signal:init?.signal??undefined},res=>{
        const chunks:Buffer[]=[];let bytes=0
        res.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>200000)res.destroy(new Error('place_response_too_large'));else chunks.push(chunk)})
        res.once('error',reject)
        res.once('aborted',()=>reject(new Error('place_response_aborted')))
        res.once('end',()=>{try{const status=res.statusCode??502;resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers:{'content-type':String(res.headers['content-type']??'application/json')}}))}catch(error){reject(error)}})
      })
      req.once('error',reject)
      // Node's proxy CONNECT may not deliver request errors until the tunnel opens.
      abort=()=>{req.destroy();reject(init?.signal?.reason??new Error('place_request_aborted'))}
      init?.signal?.addEventListener('abort',abort,{once:true})
      if(init?.signal?.aborted)abort()
    })}finally{if(abort)init?.signal?.removeEventListener('abort',abort);agent.destroy()}
  }
}
