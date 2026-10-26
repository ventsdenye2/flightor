import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quotedFare} from '../src/providers/trip/details.js';
import {searchInputSchema,type Candidate} from '../src/core/types.js';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {chromium} from 'playwright';
import {readCandidateDetails} from '../src/providers/trip/details.js';
import {parseCard} from '../src/providers/trip/parser.js';
import type {SearchNetwork} from '../src/providers/trip/browser.js';

const query=searchInputSchema.parse({origin:'BJS',destination:'TYO',departureDate:'2099-11-07',returnDate:'2099-11-10',tripType:'round_trip',adults:6,currency:'CNY'});
const candidate={price:{amount:2360,currency:'CNY',basis:'per_adult',checkoutVerified:false,totalAmount:14160}} as Candidate;
const cheaper='CNY 2,358\nRound-trip\nTotal CNY 14,148\nCarry-on baggage: Not included\nChecked baggage: Not included\nSelect';
const quoted='CNY 2,360\nRound-trip\nTotal CNY 14,160\nCarry-on baggage: 1 piece\nChecked baggage: 1 × 23 kg\nSelect';
const text=(...cards:string[])=>'Itinerary\nSelect Fare\n'+cards.join('\n');

test('later unique fare matches both displayed prices and keeps its own baggage',()=>{
  const fare=quotedFare(text(cheaper,quoted),query,candidate,[cheaper,quoted]);
  assert.equal(fare.amount,2360);assert.equal(fare.total,14160);
  assert.equal(fare.text,quoted);assert.ok(!fare.text.includes('Not included'));
});
test('missing quote, changed group total and ambiguous later brands remain rejected',()=>{
  for(const cards of [[cheaper],[quoted.replace('14,160','14,161')],[cheaper,quoted,quoted.replace('23 kg','30 kg')]]) {
    assert.throws(()=>quotedFare(text(...cards),query,candidate,cards),(error:any)=>error.code==='PRICE_CHANGED');
  }
});
test('unknown drawer structure keeps strict first-fare comparison and stable snapshot checks',()=>{
  assert.throws(()=>quotedFare(text(cheaper,quoted),query,candidate),(error:any)=>error.code==='PRICE_CHANGED');
  assert.throws(()=>quotedFare(text(cheaper),query,candidate,[quoted]),(error:any)=>error.code==='RESULTS_CHANGED');
  assert.equal(quotedFare(text(quoted),query,candidate).amount,2360);
});
test('multi-adult quote never invents a missing group total, and eager repricing stays explicit',()=>{
  const missing=quoted.replace('Total CNY 14,160\n','');
  assert.throws(()=>quotedFare(text(missing),query,candidate,[missing]),(error:any)=>error.code==='PAGE_CHANGED');
  assert.equal(quotedFare(text(cheaper),query,candidate,[cheaper],true).amount,2358);
});
test('retained drawer reads the matching card baggage and still rejects a genuinely missing quote',async()=>{
  const root=await mkdtemp(join(tmpdir(),'flight-quoted-fare-'));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    const query=searchInputSchema.parse({origin:'BJS',destination:'LIS',departureDate:'2099-10-28',currency:'USD'});
    const candidate=parseCard({label:'Flight departing from Beijing at 2099-10-28 07:45:00 and arriving at Lisbon at 2099-10-29 08:55:00',text:'Capital Airlines, Tianjin Airlines, easyJet\n33h 10m\n2 stops',priceLabel:'One-way price: US$319',airlineText:'Capital Airlines, Tianjin Airlines, easyJet',airports:['PKX','LIS']},query);
    const [itinerary]= (await readFile(new URL('./fixtures/details.txt',import.meta.url),'utf8')).split('Select Fare');
    await page.setContent(`<article><div role="group" aria-label="Flight departing from Beijing">Summary</div><button data-testid="u_select_btn" onclick="document.querySelector('.ift-drawer').hidden=false;document.querySelector('.ift-drawer').setAttribute('aria-hidden','false')">Select</button></article><section class="ift-drawer" aria-hidden="true" hidden><pre class="m-middle-flightInfo">${itinerary}</pre><div>Select Fare</div><div class="J_brandedFarePolicy"><pre>US$317\nBaggage\nCarry-on baggage: Not included\nChecked baggage: Not included</pre><button>Select</button></div><div class="J_brandedFarePolicy" id="quoted"><pre>US$319\nBaggage\nCarry-on baggage: 1 piece\nChecked baggage: 1 × 23 kg</pre><button>Select</button></div><button aria-label="Close" onclick="this.parentElement.hidden=true;this.parentElement.setAttribute('aria-hidden','true')">Close</button></section>`);
    const args={page,network:{pending:0,check(){}} as SearchNetwork,query,candidate,readCandidates:async()=>[candidate],dir:root,signal:new AbortController().signal,timeoutMs:3000,quietMs:20};
    const loaded=await readCandidateDetails(args);
    assert.equal(loaded.price.amount,319);assert.equal(loaded.details?.baggage.checked,'1 × 23 kg');
    assert.equal(loaded.details?.baggage.carryOn,'1 piece');assert.equal(loaded.details?.segments.length,3);
    await page.locator('#quoted pre').evaluate(node=>{node.textContent=node.textContent!.replace('US$319','US$999');});
    await assert.rejects(readCandidateDetails(args),(error:any)=>error.code==='PRICE_CHANGED');
    assert.equal(loaded.price.amount,319);
  }finally{await browser.close();const target=resolve(root);assert.ok(target.startsWith(resolve(tmpdir())+sep));await rm(target,{recursive:true,force:true});}
});
