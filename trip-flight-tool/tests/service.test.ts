import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {FlightTool} from '../src/index.js';
test('invalid input and pre-aborted calls do not start a browser',async()=>{
  const root=await mkdtemp(join(tmpdir(),'trip-flight-test-'));
  const tool=new FlightTool({artifactDir:root});
  try {
    const invalid=await tool.searchFlights({origin:'BJS',destination:'LIS',departureDate:'not-a-date'});
    assert.equal(invalid.status,'error');assert.equal((invalid as any).code,'INVALID_ARGUMENTS');
    const abort=new AbortController();abort.abort();
    const cancelled=await tool.searchFlights({origin:'BJS',destination:'LIS',departureDate:'2099-10-28'},{signal:abort.signal});
    assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.attempts,0);
    assert.equal((await tool.getFlightDetails({searchId:'../../etc',candidateId:'x'})).status,'error');
  } finally {await tool.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});}
});
test('stored details are installation-local snapshots and missing IDs are explicit',async()=>{
  const root=await mkdtemp(join(tmpdir(),'trip-flight-test-'));const tool=new FlightTool({artifactDir:root});
  try {
    const result=await tool.getFlightDetails({searchId:'00000000-0000-4000-8000-000000000001',candidateId:'0123456789abcdef'});
    assert.equal((result as any).code,'SEARCH_NOT_FOUND');
  } finally {await tool.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});}
});
