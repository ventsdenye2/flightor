import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {chromium} from 'playwright';
import {FlightTool} from '../src/core/service.js';
import {searchInputSchema,type SearchResult} from '../src/core/types.js';
import {resolveLocation} from '../src/core/locations.js';
import {parseCard} from '../src/providers/trip/parser.js';
import {observeSearchNetwork} from '../src/providers/trip/browser.js';

test('retained result reads details and refreshes only that drawer; concurrent calls, changed fares and cancellation remain guarded',async()=>{
  const root=await mkdtemp(join(tmpdir(),'flight-live-page-')),tool=new FlightTool({artifactDir:root});
  const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext(),page=await context.newPage();
  const query=searchInputSchema.parse({origin:'BJS',destination:'LIS',departureDate:'2099-10-28',currency:'USD'});
  const searchId='00000000-0000-4000-8000-000000000001';
  const candidate=parseCard({label:'Flight departing from Beijing at 2099-10-28 07:45:00 and arriving at Lisbon at 2099-10-29 08:55:00',text:'Capital Airlines, Tianjin Airlines, easyJet\n33h 10m\n2 stops',priceLabel:'One-way price: US$319',airlineText:'Capital Airlines, Tianjin Airlines, easyJet',airports:['PKX','LIS']},query);
  candidate.detailsState='deferred';
  const result={schemaVersion:1,searchId,status:'complete',source:'Trip.com',quoteType:'search_quote',observedAt:new Date().toISOString(),query,resolved:{origin:resolveLocation('BJS'),destination:resolveLocation('LIS')},candidates:[candidate]} as SearchResult;
  const text=await readFile(new URL('./fixtures/details.txt',import.meta.url),'utf8'),[itinerary,fare]=text.split('Select Fare');
  const html=`<article><div role="group" aria-label="Flight departing from Beijing">Summary</div><button data-testid="u_select_btn" onclick="window.opens=(window.opens||0)+1;document.querySelector('.ift-drawer').hidden=false;document.querySelector('.ift-drawer').setAttribute('aria-hidden','false')">Select</button></article><section class="ift-drawer" aria-hidden="true" hidden><pre class="m-middle-flightInfo">${itinerary}</pre><div>Select Fare</div><pre id="fare">${fare}</pre><button aria-label="Close" onclick="this.parentElement.hidden=true;this.parentElement.setAttribute('aria-hidden','true')">Close</button></section>`;
  try {
    await page.route('https://www.trip.com/**',route=>route.fulfill({contentType:'text/html',body:html}));
    await page.goto('https://www.trip.com/flights/showfarefirst?dcity=bjs&acity=lis&ddate=2099-10-28&triptype=ow&class=y&quantity=1&curr=USD');
    const network=observeSearchNetwork(page,{resultsOnly:true});
    network.searchCompleted=true;
    Object.assign(tool as any,{browser,activeSearch:{result,context,page,network,readCandidates:async()=>[candidate],persistSession:false}});
    tool.searchFlights=async()=>{assert.fail('retained details must not rerun the search');};
    await tool.store.save(result);
    const first=tool.getFlightDetails({searchId,candidateId:candidate.id});
    await page.waitForFunction(()=>document.querySelector('.ift-drawer')?.getAttribute('aria-hidden')==='false');
    assert.equal((await tool.getFlightDetails({searchId,candidateId:candidate.id}) as any).code,'BUSY');
    const loaded:any=await first;assert.equal(loaded.detailAccess,'live_page');assert.equal(loaded.candidate.details.segments.length,3);
    assert.equal((await tool.getFlightDetails({searchId,candidateId:candidate.id},{refresh:true}) as any).detailAccess,'live_page');
    assert.equal(await page.evaluate(()=>(window as any).opens),2);
    await page.locator('#fare').evaluate(el=>{el.textContent=el.textContent!.replace('US$319','US$999');});
    assert.equal((await tool.getFlightDetails({searchId,candidateId:candidate.id},{refresh:true}) as any).code,'PRICE_CHANGED');
    assert.equal((await tool.store.load(searchId)).candidates[0].price.amount,319);
    const controller=new AbortController();controller.abort();
    assert.equal((await tool.getFlightDetails({searchId,candidateId:candidate.id},{refresh:true,signal:controller.signal})).status,'cancelled');
  } finally {await tool.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});}
});
