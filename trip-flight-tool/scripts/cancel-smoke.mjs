import {FlightTool} from '../dist/index.js';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const tool=new FlightTool();const abort=new AbortController();
const started=Date.now();const timer=setTimeout(()=>abort.abort(),3000);
try {
  const result=await tool.searchFlights({origin:'BJS',destination:'LIS',departureDate:'2026-10-28',currency:'USD'},{signal:abort.signal});
  const remainingContexts=tool.browser?.contexts().length??0;
  const report={checkedAt:new Date().toISOString(),durationMs:Date.now()-started,result,remainingContexts};
  await mkdir('artifacts/verification',{recursive:true});await writeFile('artifacts/verification/cancel-smoke.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));assert.equal(result.status,'cancelled');assert.equal(remainingContexts,0);
} finally {clearTimeout(timer);await tool.close();}
