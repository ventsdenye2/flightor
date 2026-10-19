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
  description:'Search Trip.com for one adult economy one-way flights on an explicit date. Returns the cheapest displayed candidates, full captured itinerary, self-transfer/airport-change/baggage conditions and screenshot paths. Search quotes are not checkout verified. Never retry ACCESS_RESTRICTED. LOCATION_NOT_SUPPORTED requires a supported city/airport code. partial means some evidence is incomplete.',
  inputSchema:searchInputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:true},
},async(args,extra)=>response(await tool.searchFlights(args,{signal:extra.signal})));
server.registerTool('get_flight_details',{
  description:'Read the saved details of a candidate returned by search_flights. This is a snapshot, not a live price refresh. IDs are scoped to this installation; stale is reported after five minutes.',
  inputSchema:detailsInputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
},async(args)=>response(await tool.getFlightDetails(args)));
let stopping=false;
async function shutdown() {if(stopping)return;stopping=true;await tool.close();await server.close();}
process.once('SIGINT',()=>{void shutdown();});process.once('SIGTERM',()=>{void shutdown();});
process.stdin.once('end',()=>{void shutdown();});
await server.connect(new StdioServerTransport());
