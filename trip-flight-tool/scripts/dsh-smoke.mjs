import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve,join } from 'node:path';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const harness=process.env.DSH_SOURCE_ROOT??'D:/FunnyProject/deepseek-harness';
const load=createRequire(join(harness,'packages/mcp/mcp-client/package.json'));
const {Context}=await import(pathToFileURL(load.resolve('@deepseek-ai/cordis')).href);
const {default:SystemPrompt}=await import(pathToFileURL(join(harness,'packages/core/system-prompt/lib/index.js')).href);
const {default:ToolRuntime}=await import(pathToFileURL(join(harness,'packages/core/tools/lib/index.js')).href);
const mcp=await import(pathToFileURL(join(harness,'packages/mcp/mcp-client/lib/index.js')).href);
const ctx=new Context();
const report={checkedAt:new Date().toISOString(),harness,modelUsed:false,scope:process.argv.includes('--live')?'live_search':process.argv.includes('--snapshot')?'saved_details':'registration'};
try {
  await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime);
  await ctx.plugin(mcp,{serverName:'trip_flights',transport:'stdio',command:process.execPath,args:[resolve('dist/mcp/server.js')],cwd:process.cwd(),env:{},toolCallTimeoutMs:210000,failOnStartupError:true});
  const names=ctx.tools.schemas().map(t=>t.name);assert.ok(names.includes('mcp__trip_flights__search_flights'));assert.ok(names.includes('mcp__trip_flights__get_flight_details'));report.tools=names;
  const invalid=await ctx.tools.execute({signal:new AbortController().signal,callId:'trip-smoke-invalid',name:'mcp__trip_flights__search_flights',arguments:{origin:'BJS',destination:'LIS',departureDate:'2026-02-30'}});
  assert.equal(invalid.isError,true);report.invalidInput=invalid;
  if(process.argv.includes('--live')) {
    const result=await ctx.tools.execute({signal:new AbortController().signal,callId:'trip-smoke-live',name:'mcp__trip_flights__search_flights',arguments:{origin:'BJS',destination:'LIS',departureDate:'2026-10-28',currency:process.env.TRIP_FLIGHT_TEST_CURRENCY??'USD',maxResults:1}});
    report.live=result;
    if(result.isError) {
      const provider=JSON.parse(result.error?.message??'{}');report.provider=provider;
      const error=new Error(provider.message??'DSH live call failed');error.code=provider.code;throw error;
    }
    const text=result.content.find(c=>c.type==='text')?.text;const value=text?JSON.parse(text):null;
    assert.ok(value?.candidates?.[0]?.details,'DSH live search did not return complete itinerary details');
    const detail=await ctx.tools.execute({signal:new AbortController().signal,callId:'trip-smoke-details',name:'mcp__trip_flights__get_flight_details',arguments:{searchId:value.searchId,candidateId:value.candidates[0].id}});
    assert.equal(detail.isError,false);report.details=detail;
  }
  if(process.argv.includes('--snapshot')) {
    const saved=JSON.parse(await readFile('artifacts/live-cli.json','utf8'));
    const details=await ctx.tools.execute({signal:new AbortController().signal,callId:'trip-smoke-snapshot',name:'mcp__trip_flights__get_flight_details',arguments:{searchId:saved.searchId,candidateId:saved.candidates[0].id}});
    assert.equal(details.isError,false);
    const value=JSON.parse(details.content.find(c=>c.type==='text').text);
    assert.equal(value.snapshot,true);assert.equal(value.candidate.details.segments.length,3);assert.equal(value.candidate.price.amount,saved.candidates[0].price.amount);
    report.snapshot=value;
  }
  report.status='PASS';
} catch(error) {report.status=error.code==='ACCESS_RESTRICTED'?'BLOCKED':'FAIL';report.error=error.message;process.exitCode=report.status==='BLOCKED'?2:1;}
finally {await mkdir('artifacts/verification',{recursive:true});const name=process.argv.includes('--snapshot')?'dsh-snapshot-smoke':process.argv.includes('--live')?'dsh-live-smoke':'dsh-registration-smoke';await writeFile(`artifacts/verification/${name}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,scope:report.scope,tools:report.tools,error:report.error}));await ctx.fiber.dispose();}
