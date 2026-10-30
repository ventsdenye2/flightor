import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,type Browser} from 'playwright';
import {directSearchUrl,tryDirectSearch,observeSearchNetwork,verifyUrl} from '../src/providers/trip/browser.js';
import {resolveLocation} from '../src/core/locations.js';
import {searchInputSchema} from '../src/core/types.js';
let browser:Browser;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await browser.close();});
const query=searchInputSchema.parse({origin:'PVG',destination:'HND',departureDate:'2099-11-04',tripType:'round_trip',returnDate:'2099-11-07',adults:9,currency:'CNY'});
const resolved={origin:resolveLocation(query.origin),destination:resolveLocation(query.destination)};
const body='data: {"head":{"retCode":"SUCCESS"},"basicInfo":{"recordCount":2}}\n\n';

test('direct URLs retain airport scope, both dates, passengers and currency; foreign pages cannot pass validation',()=>{
  const url=new URL(directSearchUrl(query,resolved));
  assert.equal(url.searchParams.get('dcity'),'sha');assert.equal(url.searchParams.get('acity'),'tyo');
  assert.equal(url.searchParams.get('dairport'),'pvg');assert.equal(url.searchParams.get('aairport'),'hnd');
  assert.equal(url.searchParams.get('quantity'),'9');assert.equal(url.searchParams.get('rdate'),'2099-11-07');
  verifyUrl(url.toString(),query,resolved);
  assert.throws(()=>verifyUrl(url.toString().replace('www.trip.com','example.com'),query,resolved));
  assert.throws(()=>verifyUrl(url.toString().replace('showfarefirst','login'),query,resolved));
  const domestic={...query,origin:'PEK',destination:'Shanghai Hongqiao International Airport',tripType:'one_way' as const,returnDate:undefined};
  const domesticUrl=new URL(directSearchUrl(domestic,{origin:resolveLocation(domestic.origin),destination:resolveLocation(domestic.destination)}));
  assert.equal(domesticUrl.pathname,'/chinaflights/showfarefirst');assert.equal(domesticUrl.searchParams.get('aairport'),'sha');
  assert.equal(new URL(directSearchUrl({...domestic,destination:'HKG'},{origin:resolveLocation('PEK'),destination:resolveLocation('HKG')})).pathname,'/flights/showfarefirst');
});

test('direct navigation waits for a successful business response rather than accepting a loaded URL',async()=>{
  const page=await browser.newPage(),network=observeSearchNetwork(page);
  try {
    await page.route('https://www.trip.com/**',route=>route.fulfill(route.request().url().includes('FlightListSearchSSE')?{contentType:'text/event-stream',body}:{contentType:'text/html',body:'<script>fetch("/restapi/soa2/27015/FlightListSearchSSE")</script>'}));
    assert.equal(await tryDirectSearch(page,query,resolved,new AbortController().signal,network,2000),true);
    assert.equal(network.responses[0].recordCount,2);
  } finally {network.dispose();await page.close();}
});

test('normal direct failure permits form fallback and discards previous response readiness',async()=>{
  const page=await browser.newPage(),network=observeSearchNetwork(page);
  try {
    await page.route('https://www.trip.com/**',route=>route.fulfill({contentType:'text/html',body:'<main>Normal unsupported deep link</main>'}));
    assert.equal(await tryDirectSearch(page,query,resolved,new AbortController().signal,network,300),false);
    assert.equal(network.searchCompleted,false);assert.equal(network.pending,0);
  } finally {network.dispose();await page.close();}
});

test('direct access restrictions, captchas and cancellation never permit fallback',async()=>{
  for(const status of [403,429,200]) {
    const page=await browser.newPage(),network=observeSearchNetwork(page);
    try {
      await page.route('https://www.trip.com/**',route=>route.fulfill({status,contentType:'text/html',body:status===200?'Verify you are human':'Restricted'}));
      await assert.rejects(tryDirectSearch(page,query,resolved,new AbortController().signal,network,1000),(error:any)=>error.code==='ACCESS_RESTRICTED');
      const controller=new AbortController();controller.abort();
      await assert.rejects(tryDirectSearch(page,query,resolved,controller.signal,network,1000),(error:any)=>error.name==='AbortError');
    } finally {network.dispose();await page.close();}
  }
});

test('responses initiated before fallback cannot settle the next search generation',async()=>{
  const page=await browser.newPage(),network=observeSearchNetwork(page);let release:(()=>void)|undefined;
  try {
    await page.route('https://www.trip.com/**',async route=>{
      if(route.request().url().includes('FlightListSearchSSE')) {
        await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({status:403,body:'Old restricted response'});return;
      }
      await route.fulfill({contentType:'text/html',body:'<script>fetch("/restapi/soa2/27015/FlightListSearchSSE")</script>'});
    });
    await page.goto('https://www.trip.com/');
    while(!release)await page.waitForTimeout(10);
    network.resetForResubmit();release();await page.waitForTimeout(100);
    network.check();assert.equal(network.responses.length,0);assert.equal(network.searchCompleted,false);
  } finally {release?.();network.dispose();await page.close();}
});

test('formal observer ignores homepage preloads and accepts only the subsequent result-page response',async()=>{
  const page=await browser.newPage(),network=observeSearchNetwork(page,{resultsOnly:true});
  try {
    await page.route('https://www.trip.com/**',route=>route.fulfill(route.request().url().includes('FlightListSearchSSE')?{contentType:'text/event-stream',body}:{contentType:'text/html',body:'<script>fetch("/restapi/soa2/27015/FlightListSearchSSE")</script>'}));
    await page.goto('https://www.trip.com/flights/');await page.waitForTimeout(100);
    assert.equal(network.responses.length,0);
    await page.goto(directSearchUrl(query,resolved));await network.waitForSearch(new AbortController().signal,2000);
    assert.equal(network.responses.length,1);assert.equal(network.responses[0].retCode,'SUCCESS');
  } finally {network.dispose();await page.close();}
});

test('native ShowFareNext return navigation retains response validation and accepts only round-trip scope',async()=>{
  const page=await browser.newPage(),network=observeSearchNetwork(page,{resultsOnly:true,quietMs:100});
  try {
    await page.route('https://www.trip.com/**',route=>route.fulfill(route.request().url().includes('FlightMiddleSearch')?{contentType:'application/json',body:'{"head":{"retCode":"SUCCESS"},"journeyList":[{}]}'}:{contentType:'text/html',body:'<script>fetch("/restapi/soa2/27015/FlightMiddleSearch")</script>'}));
    const url=directSearchUrl(query,resolved).replace('showfarefirst','ShowFareNext');
    network.resetForResubmit('return');await page.goto(url);await network.waitForSearch(new AbortController().signal,2000);
    assert.equal(network.responses[0].retCode,'SUCCESS');verifyUrl(url,query,resolved);
    assert.throws(()=>verifyUrl(url.replace('triptype=rt','triptype=ow'),{...query,tripType:'one_way',returnDate:undefined},resolved));
  } finally {network.dispose();await page.close();}
});
