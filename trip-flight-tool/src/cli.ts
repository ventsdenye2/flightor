#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { FlightTool,locations } from './index.js';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
const help=`Usage:
  trip-flight search --from BJS --to LIS --date 2026-10-28 [--trip-type one_way|round_trip] [--return-date 2026-11-03] [--adults 1-9] [--currency CNY] [--max-results 3] [--output result.json]
  trip-flight details --search-id UUID --candidate-id ID [--refresh]
  trip-flight locations
  trip-flight login
  trip-flight mcp
Search runs headless Chrome. Login opens a window for manual sign-in and saves Trip.com session state locally.
Search returns summaries by default; --with-details captures every returned drawer. Details loads one deferred candidate on demand.
Environment: TRIP_FLIGHT_ARTIFACT_DIR, TRIP_FLIGHT_TIMEOUT_MS=180000, TRIP_FLIGHT_MAX_ATTEMPTS=2
`;
let tool:FlightTool|undefined;
const abort=new AbortController();
process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
try {
  const command=process.argv[2];
  if(command==='mcp') {await import('./mcp/server.js');}
  else if(command==='locations') console.log(JSON.stringify(locations,null,2));
  else if(command==='login') {
    tool=new FlightTool();await tool.openLogin();
    const terminal=createInterface({input:process.stdin,output:process.stderr});
    try {
      await terminal.question('Sign in to Trip.com in the opened Chrome window. After returning to Trip.com, press Enter here to save the session. ',{signal:abort.signal});
      console.log(JSON.stringify(await tool.saveLoginSession(),null,2));
    }finally{terminal.close();}
  }
  else if(!command||command==='--help'||command==='help') console.log(help);
  else {
    const {values}=parseArgs({args:process.argv.slice(3),options:{from:{type:'string'},to:{type:'string'},date:{type:'string'},'trip-type':{type:'string'},'return-date':{type:'string'},currency:{type:'string'},adults:{type:'string'},'max-results':{type:'string'},output:{type:'string'},'search-id':{type:'string'},'candidate-id':{type:'string'},'with-details':{type:'boolean'},refresh:{type:'boolean'}},strict:true});
    tool=new FlightTool();
    const result=command==='search'?await tool.searchFlights({origin:values.from,destination:values.to,departureDate:values.date,tripType:values['trip-type'],returnDate:values['return-date'],currency:values.currency,adults:values.adults?Number(values.adults):undefined,maxResults:values['max-results']?Number(values['max-results']):undefined},{signal:abort.signal,withDetails:values['with-details']}):command==='details'?await tool.getFlightDetails({searchId:values['search-id'],candidateId:values['candidate-id']},{signal:abort.signal,refresh:values.refresh}):null;
    if(!result) throw new Error(help);
    const json=JSON.stringify(result,null,2);console.log(json);if(values.output) await writeFile(values.output,json);
    if(['error','needs_user_action','cancelled'].includes(result.status))process.exitCode=1;
    else if(result.status==='partial')process.exitCode=2;
  }
} catch(error) { console.error(error instanceof Error?error.message:String(error));process.exitCode=1; }
finally {await tool?.close();}
