import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {FlightTool} from './core/service.js';
import {failure,FlightError} from './core/errors.js';

export async function startFlightWorker({tool=new FlightTool(),idleMs=600000}:{tool?:FlightTool;idleMs?:number}={}) {
  const token=randomBytes(32).toString('hex');
  let active:{requestId:string;controller:AbortController;done:Promise<unknown>}|undefined;
  let idle:NodeJS.Timeout|undefined;
  let closing=false;
  let maintenance=Promise.resolve();
  const send=(res:http.ServerResponse,status:number,value:unknown)=>{if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}};
  const server=http.createServer(async(req,res)=>{
    if(closing)return send(res,503,failure(new FlightError('WORKER_CLOSED','Flight worker is closing')));
    if(req.headers.origin||req.headers.authorization!==`Bearer ${token}`)return send(res,403,{error:'Forbidden'});
    if(req.method==='POST'&&req.url==='/cancel') {
      try {
        let body='';for await(const chunk of req){body+=chunk;if(body.length>256)throw Error('Invalid cancellation');}
        const value=JSON.parse(body),entry=active;
        if(typeof value.requestId!=='string')throw Error('Invalid cancellation');
        if(entry&&entry.requestId===value.requestId){entry.controller.abort();await entry.done;}
        return send(res,200,{status:'cancelled',released:true});
      }catch{return send(res,400,{error:'Invalid cancellation'});}
    }
    if(req.method!=='POST'||!['/search','/details'].includes(req.url??''))return send(res,404,{error:'Not found'});
    if(active)return send(res,409,failure(new FlightError('BUSY','Flight browser worker is busy',true)));
    clearTimeout(idle);
    const controller=new AbortController();
    res.once('close',()=>{if(!res.writableEnded)controller.abort();});
    // Acquire the single slot before awaiting request bytes.
    const entry={requestId:typeof req.headers['x-flight-request-id']==='string'?req.headers['x-flight-request-id']:randomUUID(),controller,done:Promise.resolve() as Promise<unknown>};active=entry;
    entry.done=(async()=>{
      try {
        let body='';for await(const chunk of req){body+=chunk;if(body.length>16000)throw new FlightError('INVALID_ARGUMENTS','Worker request too large');}
        await maintenance;
        controller.signal.throwIfAborted();
        const value=JSON.parse(body);
        if(value.refresh!==undefined&&typeof value.refresh!=='boolean'||value.withDetails!==undefined&&typeof value.withDetails!=='boolean')throw new FlightError('INVALID_ARGUMENTS','Invalid worker options');
        const result=req.url==='/search'?await tool.searchFlights(value.input,{signal:controller.signal,withDetails:value.withDetails}):await tool.getFlightDetails(value.input,{signal:controller.signal,refresh:value.refresh});
        send(res,200,result);
      } catch(error){send(res,400,failure(error));}
      finally {
        if(active===entry)active=undefined;
        if(!closing){idle=setTimeout(()=>{maintenance=tool.close().catch(()=>{});},idleMs);idle.unref();}
      }
    })();
    await entry.done;
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  const address=server.address();if(!address||typeof address==='string')throw Error('No worker address');
  return {url:`http://127.0.0.1:${address.port}`,token,async close(){
    if(closing)return;closing=true;clearTimeout(idle);active?.controller.abort();await active?.done;
    await maintenance;await tool.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }};
}

export async function requestFlightWorker(command:'search'|'details',input:unknown,options:{signal?:AbortSignal;withDetails?:boolean;refresh?:boolean}={}) {
  const endpoint=new URL(process.env.TRIP_FLIGHT_WORKER_URL!);
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.username||endpoint.password||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||!process.env.TRIP_FLIGHT_WORKER_TOKEN)throw new FlightError('INVALID_CONFIG','Flight worker must use an authenticated loopback URL');
  const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(205000)]):AbortSignal.timeout(205000);
  const requestId=randomUUID(),headers={authorization:`Bearer ${process.env.TRIP_FLIGHT_WORKER_TOKEN}`,'content-type':'application/json','x-flight-request-id':requestId};
  signal.throwIfAborted();
  try {
    const response=await fetch(new URL('/'+command,endpoint),{method:'POST',headers,body:JSON.stringify({input,withDetails:options.withDetails,refresh:options.refresh}),signal});
    const value=await response.json();
    if(!response.ok&&!(value as any).status)throw new FlightError('WORKER_UNAVAILABLE',`Flight worker returned HTTP ${response.status}`);
    return value as Awaited<ReturnType<FlightTool['searchFlights']>>;
  } catch(error) {
    if(signal.aborted) {
      // Wait for this request's browser cleanup before the API releases its
      // task slot. Never abort a later request or start another search here.
      await fetch(new URL('/cancel',endpoint),{method:'POST',headers,body:JSON.stringify({requestId}),signal:AbortSignal.timeout(35000)}).then(response=>response.body?.cancel()).catch(()=>{});
    }
    throw error;
  }
}
