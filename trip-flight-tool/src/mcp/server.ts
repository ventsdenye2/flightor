import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FlightTool,searchInputSchema,detailsInputSchema } from '../index.js';
const tool=new FlightTool();
const server=new McpServer({name:'trip-flight-tool',version:'0.1.0'});
function response(value:object) {
  const result=value as {status?:string};
  return {content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:JSON.parse(JSON.stringify(value)) as Record<string,unknown>,
    ...(['error','needs_user_action','cancelled'].includes(result.status??'')?{isError:true}:{})};
}
server.registerTool('search_flights',{
  description:'Search Trip.com economy flights for 1 to 9 adults. City names search city airports; airport names filter that airport. Round trips require departureDate and returnDate. Returns up to 3 summaries by default with per-adult prices and local times; detailsState=deferred means use get_flight_details for the chosen candidate. Quotes are not user confirmation or checkout verification. Never retry ACCESS_RESTRICTED.',
  inputSchema:searchInputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:true},
},async(args,extra)=>response(await tool.searchFlights(args,{signal:extra.signal})));
server.registerTool('get_flight_details',{
  description:'Get details for one search candidate. Deferred summaries trigger a fresh search and a price-checked drawer read for that candidate only; changed/missing flights fail. Already captured details are snapshots and stale after five minutes. No checkout verification.',
  inputSchema:detailsInputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:true},
},async(args,extra)=>response(await tool.getFlightDetails(args,{signal:extra.signal})));
let stopping=false;
async function shutdown() {if(stopping)return;stopping=true;await tool.close();await server.close();}
process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
process.stdin.once('end',()=>{void shutdown();});
await server.connect(new StdioServerTransport());
