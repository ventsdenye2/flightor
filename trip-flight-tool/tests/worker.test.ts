import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {startFlightWorker,requestFlightWorker} from '../src/worker.js';
import type {FlightTool} from '../src/core/service.js';

test('worker authenticates loopback requests, serializes callers and carries detail refresh/cancellation',async()=>{
  let finish:((value:any)=>void)|undefined,aborted=false,cleaned=false,closes=0;
  const fake={searchFlights:async(_input:any,{signal}:any)=>new Promise(resolve=>{finish=resolve;signal.addEventListener('abort',()=>{aborted=true;void delay(50).then(()=>{cleaned=true;resolve({status:'cancelled'});});},{once:true});}),getFlightDetails:async(input:any,options:any)=>({status:'complete',input,refresh:options.refresh}),close:async()=>{closes++;}} as unknown as FlightTool;
  const worker=await startFlightWorker({tool:fake,idleMs:10000});
  const oldUrl=process.env.TRIP_FLIGHT_WORKER_URL,oldToken=process.env.TRIP_FLIGHT_WORKER_TOKEN;
  process.env.TRIP_FLIGHT_WORKER_URL=worker.url;process.env.TRIP_FLIGHT_WORKER_TOKEN=worker.token;
  try {
    assert.equal((await fetch(worker.url+'/search',{method:'POST',body:'{}'})).status,403);
    assert.equal((await fetch(worker.url+'/search',{method:'POST',headers:{authorization:`Bearer ${worker.token}`,origin:'http://localhost:4178'},body:'{}'})).status,403);
    const first=requestFlightWorker('search',{});
    while(!finish)await delay(5);
    assert.equal((await requestFlightWorker('search',{}) as any).code,'BUSY');
    finish!({status:'complete',candidates:[]});assert.equal((await first).status,'complete');
    const detail:any=await requestFlightWorker('details',{searchId:'test'},{refresh:true});assert.equal(detail.refresh,true);
    finish=undefined;const controller=new AbortController();
    const pending=requestFlightWorker('search',{}, {signal:controller.signal});
    while(!finish)await delay(5);controller.abort();await assert.rejects(pending);
    assert.equal(cleaned,true);
    for(let i=0;i<100&&!aborted;i++)await delay(5);assert.equal(aborted,true);
    assert.equal((await requestFlightWorker('details',{}, {refresh:true})).status,'complete');
  } finally {
    await worker.close();
    if(oldUrl===undefined)delete process.env.TRIP_FLIGHT_WORKER_URL;else process.env.TRIP_FLIGHT_WORKER_URL=oldUrl;
    if(oldToken===undefined)delete process.env.TRIP_FLIGHT_WORKER_TOKEN;else process.env.TRIP_FLIGHT_WORKER_TOKEN=oldToken;
  }
  assert.ok(closes>=1);
});
