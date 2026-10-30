import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {observeSearchNetwork,stableFareText,sortAndStabilize} from '../src/providers/trip/browser.js';

test('short fare window cannot settle while a price request has not even received headers',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
  const network=observeSearchNetwork(page,{resultsOnly:true,quietMs:100});let release:(()=>void)|undefined;
  try {
    await page.route('https://www.trip.com/**',async route=>{
      if(route.request().url().includes('FlightMiddleSearch')) {
        await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({contentType:'application/json',body:'{"head":{"retCode":"SUCCESS"}}'});return;
      }
      await route.fulfill({contentType:'text/html',body:'<section class="ift-drawer" aria-hidden="false"><div>Select Fare</div><pre>JD5755</pre><span id="price">US$319</span></section>'});
    });
    await page.goto('https://www.trip.com/flights/showfarefirst');
    await page.evaluate(()=>{void fetch('/restapi/soa2/27015/FlightMiddleSearch').then(()=>{document.querySelector('#price')!.textContent='US$999';});});
    while(!release)await page.waitForTimeout(5);
    assert.equal(network.pending,1);
    let completed=false;const stable=stableFareText(page,new AbortController().signal,3000,network,100).then(value=>{completed=true;return value;});
    await page.waitForTimeout(200);assert.equal(completed,false);
    release();assert.match(await stable,/US\$999/);assert.equal(network.pending,0);
  } finally {release?.();network.dispose();await browser.close();}
});

test('short list window waits for final business completion and the resulting DOM price',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
  const network=observeSearchNetwork(page,{resultsOnly:true,quietMs:100});let release:(()=>void)|undefined;
  try {
    await page.route('https://www.trip.com/**',async route=>{
      if(route.request().url().includes('FlightListSearchSSE')) {
        await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({contentType:'text/event-stream',body:'data: {"head":{"retCode":"SUCCESS"},"basicInfo":{"recordCount":1}}\n\n'});return;
      }
      await route.fulfill({contentType:'text/html',body:'<button role="tab" aria-label="Cheapest" aria-selected="true">Cheapest</button><article><div role="group" aria-label="Flight departing from Beijing"><span id="price">US$319</span></div><button data-testid="u_select_btn">Select</button></article>'});
    });
    await page.goto('https://www.trip.com/flights/showfarefirst');
    await page.evaluate(()=>{void fetch('/restapi/soa2/27015/FlightListSearchSSE').then(()=>{document.querySelector('#price')!.textContent='US$999';});});
    while(!release)await page.waitForTimeout(5);
    let completed=false;const stable=sortAndStabilize(page,new AbortController().signal,3000,network.check,100,network).then(value=>{completed=true;return value;});
    await page.waitForTimeout(200);assert.equal(completed,false);
    release();assert.equal(await stable,true);assert.equal(await page.locator('#price').innerText(),'US$999');assert.equal(network.searchCompleted,true);
  } finally {release?.();network.dispose();await browser.close();}
});

test('three-summary readiness ignores lower-card updates and fare preloads, while fare reads still wait for them',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
  const network=observeSearchNetwork(page,{resultsOnly:true,quietMs:100});let release:(()=>void)|undefined;
  try {
    await page.route('https://www.trip.com/**',async route=>{
      const url=route.request().url();
      if(url.includes('FlightListSearchSSE')){await route.fulfill({contentType:'text/event-stream',body:'data: {"head":{"retCode":"SUCCESS"},"basicInfo":{"recordCount":4}}\n\n'});return;}
      if(url.includes('FlightMiddleSearch')){await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({contentType:'application/json',body:'{}'});return;}
      await route.fulfill({contentType:'text/html',body:`<button role="tab" aria-label="Cheapest" aria-selected="true">Cheapest</button><div id="rows"></div><section class="ift-drawer" aria-hidden="false"><div>Select Fare</div><pre>JD5755</pre><span id="price">US$319</span></section><script>
      const row=n=>'<article><div role="group" aria-label="Flight departing from Beijing">Fare '+n+'</div><button data-testid="u_select_btn">Select</button></article>';
      rows.innerHTML=row(1);setTimeout(()=>{rows.insertAdjacentHTML('beforeend',row(2)+row(3)+row(4));setInterval(()=>{rows.lastElementChild.firstElementChild.textContent='Changing lower fare '+Date.now()},20)},250);
      fetch('/restapi/soa2/27015/FlightListSearchSSE');fetch('/restapi/soa2/27015/FlightMiddleSearch').then(()=>price.textContent='US$999');</script>`});
    });
    await page.goto('https://www.trip.com/flights/showfarefirst');
    await network.waitForSearch(new AbortController().signal,3000);assert.equal(network.pending,1);assert.equal(network.searchPending,0);
    assert.equal(await sortAndStabilize(page,new AbortController().signal,3000,network.check,100,network,3,4),true);
    assert.ok(await page.getByRole('group',{name:/Flight departing/}).count()>=3);
    let completed=false;const fare=stableFareText(page,new AbortController().signal,3000,network,100).then(value=>{completed=true;return value;});
    await page.waitForTimeout(200);assert.equal(completed,false);
    release!();assert.match(await fare,/US\$999/);
  } finally {release?.();network.dispose();await browser.close();}
});
