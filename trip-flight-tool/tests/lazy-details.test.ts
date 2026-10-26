import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FlightTool,type SearchResult} from '../src/index.js';
import {tripOnlyState} from '../src/browser/session.js';

test('session import omits only un-restorable empty out-of-line records without discarding valid login state',()=>{
  const state:any={cookies:[{domain:'.trip.com',name:'test',value:'test'}],origins:[{origin:'https://www.trip.com',localStorage:[{name:'test',value:'test'}],indexedDB:[{name:'db',version:1,stores:[{name:'s',autoIncrement:false,indexes:[],records:[{},{key:'valid',value:'saved'},{key:'undefined-value'},{value:'must-remain'}]},{name:'inline',keyPath:'id',autoIncrement:false,indexes:[],records:[{value:{id:1}}]}]}]}]};
  const clean=tripOnlyState(state);
  assert.equal(clean.cookies.length,1);assert.equal(clean.origins[0].localStorage.length,1);
  assert.equal((clean.origins[0] as any).indexedDB[0].stores[0].records.length,3);
  assert.equal((clean.origins[0] as any).indexedDB[0].stores[1].records.length,1);
  assert.equal(state.origins[0].indexedDB[0].stores[0].records.length,4);
});

const searchId='00000000-0000-4000-8000-000000000001',candidateId='0123456789abcdef';
const fixture=()=>({schemaVersion:1,searchId,status:'complete',source:'Trip.com',quoteType:'search_quote',resultLevel:'summary',query:{origin:'BJS',destination:'LIS',departureDate:'2099-11-04',currency:'CNY'},observedAt:new Date().toISOString(),candidates:[{id:candidateId,price:{amount:1234,currency:'CNY',checkoutVerified:false},detailsState:'deferred',details:null}]} as unknown as SearchResult);

test('deferred details fetch only the chosen identity; saved and refreshed prices retain checkout boundary',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lazy-flight-')),tool=new FlightTool({artifactDir:root});
  try {
    const original=fixture();await tool.store.save(original);let calls=0;
    tool.searchFlights=async(query,options)=>{
      calls++;assert.deepEqual(query,original.query);assert.equal(options?.detailCandidate?.id,candidateId);
      return {...original,candidates:[{...original.candidates[0],details:{observedAt:new Date().toISOString(),segments:[],connections:[],baggage:{carryOn:'7kg',checked:null},warnings:[],rawTextPath:'local',screenshotPath:'local'}}]};
    };
    const first:any=await tool.getFlightDetails({searchId,candidateId});
    assert.equal(first.status,'complete');assert.equal(first.candidate.detailsState,'ready');assert.equal(first.candidate.price.checkoutVerified,false);
    await tool.getFlightDetails({searchId,candidateId});assert.equal(calls,1);
    await tool.getFlightDetails({searchId,candidateId},{refresh:true});assert.equal(calls,2);
  } finally {await tool.close();await rm(root,{recursive:true,force:true});}
});

test('changed prices, missing candidates, unavailable details and cancellation never overwrite the summary',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lazy-flight-')),tool=new FlightTool({artifactDir:root});
  try {
    const original=fixture();await tool.store.save(original);
    for(const [candidate,code] of [
      [{...original.candidates[0],price:{amount:999,currency:'CNY'},details:{observedAt:new Date().toISOString()}},'PRICE_CHANGED'],
      [{...original.candidates[0],id:'ffffffffffffffff'},'DETAILS_UNAVAILABLE'],
      [original.candidates[0],'DETAILS_UNAVAILABLE']
    ] as const) {
      tool.searchFlights=async()=>({...original,candidates:[candidate as any]});
      assert.equal((await tool.getFlightDetails({searchId,candidateId}) as any).code,code);
      assert.equal((await tool.store.load(searchId)).candidates[0].detailsState,'deferred');
    }
    const controller=new AbortController();
    tool.searchFlights=async()=>{controller.abort();return {...original,candidates:[{...original.candidates[0],details:{observedAt:new Date().toISOString()} as any}]};};
    assert.equal((await tool.getFlightDetails({searchId,candidateId},{signal:controller.signal})).status,'cancelled');
    assert.equal((await tool.store.load(searchId)).candidates[0].details,null);
  } finally {await tool.close();await rm(root,{recursive:true,force:true});}
});
