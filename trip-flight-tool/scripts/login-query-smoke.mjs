// Interactive experiment: the human signs in, then one query uses that exact
// browser context. Only Trip.com state is saved; no Google credentials are read.
import {createInterface} from 'node:readline/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import {FlightTool} from '../dist/index.js';
const tool=new FlightTool({maxAttempts:2});
const terminal=createInterface({input:process.stdin,output:process.stderr});
try {
  await tool.openLogin();
  console.log('LOGIN_WINDOW_READY');
  await terminal.question('Sign in to Trip.com manually, return to Trip.com, then press Enter here. ');
  console.log(JSON.stringify(await tool.saveLoginSession()));
  const startedAt=new Date().toISOString();
  const result=await tool.searchFlights({origin:'BJS',destination:'LIS',departureDate:'2026-10-28',currency:'USD',maxResults:5});
  await mkdir('artifacts/verification',{recursive:true});
  await writeFile('artifacts/verification/login-query-smoke.json',JSON.stringify({startedAt,finishedAt:new Date().toISOString(),manualLoginConfirmed:true,sameLoginContext:true,result},null,2));
  console.log(JSON.stringify(result,null,2));
}finally{terminal.close();await tool.close();}
