import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const client=new Client({name:'trip-flight-smoke',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/mcp/server.js')],cwd:process.cwd(),stderr:'inherit'});
await mkdir('artifacts/verification',{recursive:true});
try {
  await client.connect(transport);
  const listed=await client.listTools();
  assert.deepEqual(listed.tools.map(t=>t.name).sort(),['get_flight_details','search_flights']);
  const invalid=await client.callTool({name:'search_flights',arguments:{origin:'BJS',destination:'LIS',departureDate:'2026-02-30'}});
  assert.equal(invalid.isError,true);assert.equal(invalid.structuredContent.code,'INVALID_ARGUMENTS');
  let live;
  if(process.argv.includes('--live')) {
    live=await client.callTool({name:'search_flights',arguments:{origin:process.env.TRIP_FLIGHT_TEST_ORIGIN??'BJS',destination:'LIS',departureDate:process.env.TRIP_FLIGHT_TEST_DATE??'2026-10-28',currency:process.env.TRIP_FLIGHT_TEST_CURRENCY??'USD',maxResults:1}},undefined,{timeout:210000});
    const result=live.structuredContent;
    assert.equal(result.status,'complete','Live smoke requires complete search and itinerary; restrictions/errors are not a PASS');
    if(result.candidates?.[0]?.details) {
      const detail=await client.callTool({name:'get_flight_details',arguments:{searchId:result.searchId,candidateId:result.candidates[0].id}});
      assert.equal(detail.structuredContent.candidate.id,result.candidates[0].id);assert.equal(detail.structuredContent.snapshot,true);
    }
  }
  const report={checkedAt:new Date().toISOString(),protocol:'MCP stdio',tools:listed.tools.map(t=>({name:t.name,inputSchema:t.inputSchema})),invalidInputError:invalid.structuredContent,live:live?.structuredContent??null};
  await writeFile('artifacts/verification/mcp-smoke.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({protocol:'PASS',liveStatus:report.live?.status??'not_run',lowest:report.live?.candidates?.[0]?.price??null}));
} finally {await client.close();}
