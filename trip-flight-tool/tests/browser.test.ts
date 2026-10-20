import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,type Browser} from 'playwright';
import {openCandidate,openSearchResults,waitForResults,sortAndStabilize,observeSearchNetwork,completeSearchWithSamePageRetry,chooseLocation,chooseDepartureDate,choosePassengers,summarizeMiddleResponse,summarizeJsonSearchResponse,publicSearchUrl} from '../src/providers/trip/browser.js';
import {resolveLocation} from '../src/core/locations.js';
let browser:Browser;
before(async()=>{browser=await chromium.launch({channel:'chrome',headless:true});});
after(async()=>{await browser?.close();});
test('domestic JSON search waits for its final poll and retains the chinaflights source path',async()=>{
  const page=await browser.newPage();const network=observeSearchNetwork(page);
  try {
    await page.route('https://www.trip.com/**',route=>{
      const url=new URL(route.request().url());
      return route.fulfill(url.pathname.endsWith('FlightListSearch')?{contentType:'application/json',body:JSON.stringify({head:{retCode:'SUCCESS'},basicInfo:{recordCount:2,pollInterval:url.searchParams.has('final')?-1:100},itineraryList:[{},{}]})}
        :{contentType:'text/html',body:'<script>fetch("/restapi/soa2/27015/FlightListSearch").then(()=>setTimeout(()=>fetch("/restapi/soa2/27015/FlightListSearch?final"),250))</script>'});
    });
    await page.goto('https://www.trip.com/chinaflights/showfarefirst');
    await network.waitForSearch(new AbortController().signal,3000);
    assert.equal(network.responses.length,2);assert.equal(network.responses.at(-1)?.recordCount,2);
    assert.ok(network.responses.every(r=>r.retCode==='SUCCESS'));
    assert.equal(new URL(publicSearchUrl(page.url()+'?dcity=bjs&acity=sha&privateToken=secret')).pathname,'/chinaflights/showfarefirst');
    assert.ok(!publicSearchUrl(page.url()+'?privateToken=secret').includes('secret'));
    assert.deepEqual(summarizeJsonSearchResponse('{"head":{"retCode":"SUCCESS"},"basicInfo":{"recordCount":0,"pollInterval":-1},"itineraryList":[]}'),{retCode:'SUCCESS',recordCount:0,complete:true});
    for(const bad of [{head:{retCode:'FAIL'}},{head:{retCode:'SUCCESS'},basicInfo:{recordCount:null,pollInterval:-1},itineraryList:[]},{head:{retCode:'SUCCESS'},basicInfo:{recordCount:2,pollInterval:-1},itineraryList:[]},{head:{retCode:'SUCCESS'},basicInfo:{recordCount:0},itineraryList:[]}])assert.throws(()=>summarizeJsonSearchResponse(JSON.stringify(bad)));
  } finally {network.dispose();await page.close();}
});
test('result navigation and flight responses finish even when an unrelated image never loads',{timeout:10000},async()=>{
  const page=await browser.newPage();page.setDefaultTimeout(2000);page.setDefaultNavigationTimeout(2000);
  const network=observeSearchNetwork(page);let releaseImage:(()=>Promise<void>)|undefined;
  try {
    await page.route('https://www.trip.com/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/slow-image.png') {await new Promise<void>(resolve=>{releaseImage=async()=>{await route.abort().catch(()=>{});resolve();};});return;}
      if(path.includes('FlightListSearchSSE')) {await route.fulfill({contentType:'text/event-stream',body:'data: {"head":{"retCode":"SUCCESS"},"basicInfo":{"recordCount":2}}\n\n'});return;}
      await route.fulfill({contentType:'text/html',body:path.includes('showfarefirst')
        ?'<img src="/slow-image.png"><script>fetch("/restapi/soa2/27015/FlightListSearchSSE")</script><main>Result page</main>'
        :'<button onclick="location.href=\'/flights/showfarefirst?dcity=sha&acity=lis\'">Search</button>'});
    });
    await page.goto('https://www.trip.com/flights/');
    await openSearchResults(page);
    await network.waitForSearch(new AbortController().signal,2000);
    assert.equal(new URL(page.url()).pathname,'/flights/showfarefirst');
    assert.equal(await page.evaluate(()=>document.readyState),'interactive');
    assert.equal(network.responses[0].recordCount,2);
  } finally {await releaseImage?.();network.dispose();await page.close();}
});
test('passenger selection resets restored children/cabin and supports both increasing and decreasing adults',async()=>{
  const page=await browser.newPage();
  try {
    await page.setContent(`<button data-testid="passengers_total_num" onclick="document.getElementById('passengers').hidden=!document.getElementById('passengers').hidden">4 adults · Business</button><section id="passengers" hidden>${['AdultCount','ChildCount','BabyCount'].map((type,index)=>`<div><span data-testid="${type}_minus" style="display:inline-block;width:30px;height:30px"></span><span class="stepper-num">${index===0?4:1}</span><span data-testid="${type}_plus" style="display:inline-block;width:30px;height:30px"></span></div>`).join('')}<button data-testid="selected_cabin" onclick="document.getElementById('economy').hidden=false">Business</button><button id="economy" data-testid="cabin_Y" hidden>Economy</button></section>`);
    await page.addScriptTag({content:`
      const summary=document.querySelector('[data-testid=passengers_total_num]');
      const refresh=()=>{const adult=document.querySelector('[data-testid=AdultCount_plus]').parentElement.innerText.trim();summary.textContent=adult+' '+(adult==='1'?'adult':'adults')+' · '+document.querySelector('[data-testid=selected_cabin]').textContent;};
      for(const type of ['AdultCount','ChildCount','BabyCount'])for(const direction of ['plus','minus']) {
        const button=document.querySelector('[data-testid='+type+'_'+direction+']');
        button.onclick=()=>{const number=button.parentElement.querySelector('.stepper-num');number.textContent=String(Number(number.textContent)+(direction==='plus'?1:-1));refresh();};
      }
      document.querySelector('[data-testid=cabin_Y]').onclick=()=>{document.querySelector('[data-testid=selected_cabin]').textContent='Economy';document.getElementById('economy').hidden=true;refresh();};
    `});
    await choosePassengers(page,9,new AbortController().signal);
    assert.equal(await page.getByTestId('passengers_total_num').innerText(),'9 adults · Economy');
    for(const type of ['ChildCount','BabyCount'])assert.equal(await page.getByTestId(`${type}_plus`).locator('..').innerText(),'0');
    await choosePassengers(page,2,new AbortController().signal);
    assert.equal(await page.getByTestId('passengers_total_num').innerText(),'2 adults · Economy');
    await choosePassengers(page,1,new AbortController().signal);
    assert.equal(await page.getByTestId('passengers_total_num').innerText(),'1 adult · Economy');
    for(const count of [0,10,1.5])await assert.rejects(choosePassengers(page,count,new AbortController().signal),(error:any)=>error.code==='INVALID_ARGUMENTS');
  } finally {await page.close();}
});
test('native return phase validates Middle business status without mistaking journey count for inventory',async()=>{
  const page=await browser.newPage();const network=observeSearchNetwork(page);
  try {
    network.resetForResubmit('return');
    await page.route('**/*',route=>route.fulfill(route.request().url().includes('FlightMiddleSearch')
      ?{contentType:'application/json',body:JSON.stringify({head:{retCode:'SUCCESS'},journeyList:[{},{}]})}
      :{contentType:'text/html',body:'<script>fetch("/restapi/soa2/27015/FlightMiddleSearch")</script>'}));
    await page.goto('https://www.trip.com/');
    await network.waitForSearch(new AbortController().signal,3000);
    assert.equal(network.responses[0].retCode,'SUCCESS');
    assert.equal(network.responses[0].recordCount,undefined);
    assert.throws(()=>summarizeMiddleResponse('{"head":{"retCode":"FAIL"},"journeyList":[]}'));
    assert.equal(summarizeMiddleResponse('{"head":{"retCode":"SUCCESS"}}').complete,false);
  } finally {network.dispose();await page.close();}
});
test('choosing a destination replaces all restored city chips and preserves the origin',{timeout:10000},async()=>{
  const page=await browser.newPage();
  try{
    await page.setContent(`<div data-testid="search_city_from0_wrapper"><span data-testid="cityLabel_name_0">Beijing</span><button aria-label="Remove" onclick="this.previousElementSibling.remove();this.remove()">x</button></div>
      <div data-testid="search_city_to0_wrapper"><input data-testid="search_city_to0" value="original form"></div>
      <div data-testid="search_city_to0_wrapper"><span data-testid="cityLabel_name_0">Lisbon</span><button data-testid="cityLabel_delete_0" aria-label="Remove" onclick="this.previousElementSibling.remove();this.remove()">x</button><span data-testid="cityLabel_name_1">Tokyo</span><button data-testid="cityLabel_delete_1" aria-label="Remove" onclick="this.previousElementSibling.remove();this.remove()">x</button><input data-testid="search_city_to0" onkeydown="if(event.key==='Backspace'&&!this.value){[...this.parentElement.querySelectorAll('[data-testid^=cityLabel_delete_]')].at(-1)?.click()}"></div>
      <button onclick="const label=document.createElement('span');label.dataset.testid='cityLabel_name_0';label.textContent='Paris';[...document.querySelectorAll('[data-testid=search_city_to0_wrapper]')].at(-1).prepend(label)">Paris · All airports France</button>`);
    await chooseLocation(page,'search_city_to0',resolveLocation('PAR'));
    assert.equal(await page.getByTestId('search_city_to0_wrapper').last().innerText(),'Paris');
    assert.equal(await page.getByTestId('search_city_to0').last().inputValue(),'PAR');
    assert.equal(await page.getByTestId('search_city_to0').first().inputValue(),'original form');
    assert.match(await page.getByTestId('search_city_from0_wrapper').innerText(),/Beijing/);
  }finally{await page.close();}
});
test('global airport selection chooses its IATA row rather than a nearby city',{timeout:10000},async()=>{
  const page=await browser.newPage();
  try{
    await page.setContent(`<div data-testid="search_city_to0_wrapper"><input data-testid="search_city_to0"></div>
      <button onclick="document.body.dataset.wrong='yes'">Prague · All airports Czechia</button>
      <button onclick="const label=document.createElement('span');label.dataset.testid='cityLabel_name_0';label.textContent='Prague';document.querySelector('[data-testid=search_city_to0_wrapper]').prepend(label)">PRG Václav Havel Airport</button>`);
    await chooseLocation(page,'search_city_to0',resolveLocation('布拉格'));
    assert.equal(await page.getByTestId('search_city_to0').inputValue(),'PRG');
    assert.equal(await page.getByTestId('search_city_to0_wrapper').innerText(),'Prague');
    assert.equal(await page.locator('body').getAttribute('data-wrong'),null);
  }finally{await page.close();}
});
test('same-name cities are identified by their airport metadata regardless of result order',async()=>{
  const page=await browser.newPage();
  try {
    await page.setContent(`<div data-testid="search_city_to0_wrapper"><input data-testid="search_city_to0"></div><ul>
      <li><div role="button" onclick="document.body.dataset.wrong='Canada'">London · All airports Canada</div><span data-value='{"cityCode":"YXU","airportCode":"YXU"}'>YXU London International Airport</span></li>
      <li><div role="button" onclick="document.body.dataset.wrong='South Africa'">East london · All airports South Africa</div><span data-value='{"cityCode":"ELS","airportCode":"ELS"}'>ELS King Phalo Airport</span></li>
      <li><div role="button" onclick="const label=document.createElement('span');label.dataset.testid='cityLabel_name_0';label.textContent='London';document.querySelector('[data-testid=search_city_to0_wrapper]').prepend(label)">London · All airports United Kingdom</div><span data-value='{"cityCode":"LON","airportCode":"LHR"}'>LHR Heathrow Airport</span></li>
      </ul>`);
    await chooseLocation(page,'search_city_to0',resolveLocation('LON'));
    assert.equal(await page.getByTestId('search_city_to0_wrapper').innerText(),'London');
    assert.equal(await page.locator('body').getAttribute('data-wrong'),null);
  } finally {await page.close();}
});
test('city selection waits for an asynchronously rendered native chip',async()=>{
  const page=await browser.newPage();
  try {
    await page.setContent(`<div data-testid="search_city_to0_wrapper"><input data-testid="search_city_to0"></div><button onclick="setTimeout(()=>{const label=document.createElement('span');label.dataset.testid='cityLabel_name_0';label.textContent='Tokyo';document.querySelector('[data-testid=search_city_to0_wrapper]').prepend(label)},200)">Tokyo · All airports Japan</button>`);
    await chooseLocation(page,'search_city_to0',resolveLocation('东京'));
    assert.equal(await page.getByTestId('search_city_to0_wrapper').innerText(),'Tokyo');
  } finally {await page.close();}
});
test('keyboard deletion clears restored chips even when the native popup covers Remove controls',async()=>{
  const page=await browser.newPage();page.setDefaultTimeout(1500);
  try {
    await page.setContent(`<div data-testid="search_city_from0_wrapper"><span data-testid="cityLabel_name_0">Beijing</span><button data-testid="cityLabel_delete_0" onclick="const target=this;setTimeout(()=>{target.previousElementSibling.remove();target.remove()},80)">Remove</button><input data-testid="search_city_from0" oninput="window.activeWrapper='search_city_from0_wrapper';document.getElementById('popup').hidden=false"></div>
      <div data-testid="search_city_to0_wrapper"><span data-testid="cityLabel_name_0">Tokyo</span><button data-testid="cityLabel_delete_0" onclick="const target=this;setTimeout(()=>{target.previousElementSibling.remove();target.remove()},80)">Remove</button><input data-testid="search_city_to0" oninput="window.activeWrapper='search_city_to0_wrapper';document.getElementById('popup').hidden=false"></div>
      <div id="popup" hidden style="position:fixed;inset:0;background:white;z-index:9999"><button onclick="selectLocation('Shanghai Pudong')">PVG Shanghai Pudong International Airport</button><button onclick="selectLocation('Lisbon')">Lisbon · All airports</button></div>`);
    await page.addScriptTag({content:`
      for(const input of document.querySelectorAll('input')) {
        input.onfocus=()=>{window.activeWrapper=input.parentElement.dataset.testid;document.getElementById('popup').hidden=false;};
        input.onkeydown=event=>{if(event.key!=='Backspace'||input.value)return;const labels=input.parentElement.querySelectorAll('[data-testid^=cityLabel_name_]');const label=labels[labels.length-1];if(!label)return;if(input.dataset.selected!=='yes'){input.dataset.selected='yes';input.dataset.selectedAt=String(Date.now());return;}if(Date.now()-Number(input.dataset.selectedAt)<200)return;input.dataset.selected='no';const remove=label.nextElementSibling;setTimeout(()=>{label.remove();remove.remove()},80);};
      }
      window.selectLocation=name=>{const label=document.createElement('span');label.dataset.testid='cityLabel_name_0';label.textContent=name;document.querySelector('[data-testid='+window.activeWrapper+']').prepend(label);document.getElementById('popup').hidden=true;};
    `});
    await chooseLocation(page,'search_city_from0',resolveLocation('PVG'));
    await chooseLocation(page,'search_city_to0',resolveLocation('LIS'));
    assert.equal(await page.getByTestId('search_city_from0_wrapper').innerText(),'Shanghai Pudong');
    assert.equal(await page.getByTestId('search_city_to0_wrapper').innerText(),'Lisbon');
  } finally {await page.close();}
});
test('global city matching uses airport identity across translated provider names and fails on ambiguity',async()=>{
  for(const code of ['BJS','TYO','PAR','NYC','SAO','SYD']) {
    const page=await browser.newPage();const location=resolveLocation(code);
    if(location.kind!=='city'){await page.close();continue;}
    try {
      await page.setContent(`<div data-testid="search_city_to0_wrapper"><input data-testid="search_city_to0"></div><ul><li><div role="button" onclick="const label=document.createElement('span');label.dataset.testid='cityLabel_name_0';label.textContent='Selected';document.querySelector('[data-testid=search_city_to0_wrapper]').prepend(label)">Provider local name · All airports</div><span data-value='{"airportCode":"${location.airports[0]}"}'>Airport</span></li></ul>`);
      await chooseLocation(page,'search_city_to0',location);
      assert.equal(await page.getByTestId('search_city_to0_wrapper').innerText(),'Selected');
    } finally {await page.close();}
  }
  const page=await browser.newPage();
  try {
    await page.setContent(`<div data-testid="search_city_to0_wrapper"><input data-testid="search_city_to0"></div><button>London · All airports Canada</button><button>London · All airports United Kingdom</button>`);
    await assert.rejects(chooseLocation(page,'search_city_to0',resolveLocation('LON')),(error:any)=>error.code==='LOCATION_SELECTION_FAILED');
    assert.equal(await page.getByTestId('search_city_to0_wrapper').innerText(),'');
  } finally {await page.close();}
});
async function calendarFixture(initial:string,options:{minimum?:string;maximum?:string;disabledDate?:string}={}) {
  const page=await browser.newPage();
  page.setDefaultTimeout(1500);
  await page.setContent('<div role="group" aria-label="Depart: restored date"><span data-testid="search_date_depart0">Restored date</span></div><div id="calendar" hidden></div>');
  await page.evaluate(config=>{(window as any).calendarConfig=config;},{initial,options});
  await page.addScriptTag({content:await readFile(new URL('./fixtures/calendar.js',import.meta.url),'utf8')});
  return page;
}
test('restored November departure navigates backward to October without clicking next',async()=>{
  const page=await calendarFixture('2026-11');
  try{
    await chooseDepartureDate(page,'2026-10-28',new AbortController().signal);
    assert.equal(await page.getByTestId('search_date_depart0').getAttribute('data-date'),'2026-10-28');
    assert.equal(await page.locator('body').getAttribute('data-previous'),'1');
    assert.equal(await page.locator('body').getAttribute('data-next'),null);
  }finally{await page.close();}
});
test('calendar handles earlier years and later years by comparing complete months',async()=>{
  for(const [initial,target,direction] of [['2027-09','2026-10-28','previous'],['2026-11','2027-02-05','next']]){
    const page=await calendarFixture(initial);
    try{
      await chooseDepartureDate(page,target,new AbortController().signal);
      assert.equal(await page.getByTestId('search_date_depart0').getAttribute('data-date'),target);
      assert.ok(Number(await page.locator('body').getAttribute(`data-${direction}`))>0);
    }finally{await page.close();}
  }
});
test('a date in the second visible month needs no navigation',async()=>{
  const page=await calendarFixture('2026-12');
  try{
    await chooseDepartureDate(page,'2027-01-05',new AbortController().signal);
    assert.equal(await page.getByTestId('search_date_depart0').getAttribute('data-date'),'2027-01-05');
    assert.equal(await page.locator('body').getAttribute('data-previous'),null);
    assert.equal(await page.locator('body').getAttribute('data-next'),null);
  }finally{await page.close();}
});
test('disabled calendar boundary returns a date error without waiting for a click',async()=>{
  const page=await calendarFixture('2026-11',{minimum:'2026-11'});
  try{
    await assert.rejects(chooseDepartureDate(page,'2026-10-28',new AbortController().signal),(error:any)=>error.code==='INVALID_ARGUMENTS'&&/calendar window/.test(error.message));
    assert.equal(await page.getByTestId('search_date_depart0').getAttribute('data-date'),null);
    assert.equal(await page.locator('body').getAttribute('data-previous'),null);
  }finally{await page.close();}
});
test('unavailable date inherited from its gridcell is not selected',async()=>{
  const page=await calendarFixture('2026-10',{disabledDate:'2026-10-28'});
  try{
    await assert.rejects(chooseDepartureDate(page,'2026-10-28',new AbortController().signal),(error:any)=>error.code==='INVALID_ARGUMENTS');
    assert.equal(await page.getByTestId('search_date_depart0').getAttribute('data-date'),null);
  }finally{await page.close();}
});
test('cancelled date selection does not open the calendar',async()=>{
  const page=await calendarFixture('2026-10');const abort=new AbortController();abort.abort();
  try{
    await assert.rejects(chooseDepartureDate(page,'2026-10-28',abort.signal),(error:any)=>error.name==='AbortError');
    assert.equal(await page.getByRole('grid').count(),0);
  }finally{await page.close();}
});
test('both observed fare-button variants open the associated candidate row',async()=>{
  const page=await browser.newPage();
  try {
    await page.setContent(`<main>
      <section><div role="group" aria-label="Flight departing from Beijing A">A</div><button data-testid="u_select_btn" aria-label="Select this fare" onclick="document.body.dataset.selected='A'">View Details</button></section>
      <section><div role="group" aria-label="Flight departing from Beijing B">B</div><button data-testid="u_select_btn" onclick="document.body.dataset.selected='B'">Select</button></section>
    </main>`);
    await openCandidate(page,1);assert.equal(await page.locator('body').getAttribute('data-selected'),'B');
    await openCandidate(page,0);assert.equal(await page.locator('body').getAttribute('data-selected'),'A');
  }finally{await page.close();}
});
test('explicit no-available-flights page is not a loading timeout',async()=>{
  const page=await browser.newPage();
  try {
    await page.setContent('<main>0 flights<br>Sorry, no available flights found</main>');
    assert.equal(await waitForResults(page,new AbortController().signal,500),'no_results');
  }finally{await page.close();}
});
test('results cleared after sorting fail instead of confirming a cheapest fare',async()=>{
  const page=await browser.newPage();
  try {
    await page.setContent(`<button role="tab" aria-label="Cheapest" aria-selected="false" onclick="this.setAttribute('aria-selected','true');document.querySelector('[role=group]').remove();document.querySelector('main').textContent='Sorry, no available flights found'">Cheapest</button><main><div role="group" aria-label="Flight departing from Beijing A">A</div></main>`);
    await assert.rejects(sortAndStabilize(page,new AbortController().signal,1000),(error:any)=>error.code==='RESULTS_CHANGED');
  }finally{await page.close();}
});
test('sorting waits through a temporary empty render and captures the returning results',async()=>{
  const page=await browser.newPage();
  try{
    await page.setContent('<button role="tab" aria-label="Cheapest" aria-selected="false">Cheapest</button><main><div role="group" aria-label="Flight departing from Beijing A">A</div></main>');
    await page.evaluate(()=>{
      document.querySelector('button')!.onclick=()=>{
        document.querySelector('button')!.setAttribute('aria-selected','true');
        document.querySelector('main')!.innerHTML='Sorry, no available flights found';
        setTimeout(()=>{document.querySelector('main')!.innerHTML='<div role="group" aria-label="Flight departing from Beijing A"><span role="region">Test Airline</span><span role="textbox">PEK</span><span role="textbox">LIS</span></div>';},250);
      };
    });
    assert.equal(await sortAndStabilize(page,new AbortController().signal,3000),true);
  }finally{await page.close();}
});
test('a same-text flight badge is ignored and an already-selected sort tab is not clicked again',async()=>{
  const page=await browser.newPage();
  try{
    await page.setContent('<span onclick="document.body.dataset.badgeClicked=\'yes\'">Cheapest</span><button role="tab" aria-label="Cheapest" aria-selected="true" onclick="document.body.dataset.tabClicked=\'yes\'">Cheapest</button><div role="group" aria-label="Flight departing from Beijing A"><span role="region">Test Airline</span><span role="textbox">PEK</span><span role="textbox">LIS</span></div>');
    assert.equal(await sortAndStabilize(page,new AbortController().signal,3000),true);
    assert.equal(await page.locator('body').getAttribute('data-badge-clicked'),null);
    assert.equal(await page.locator('body').getAttribute('data-tab-clicked'),null);
  }finally{await page.close();}
});
test('successful response with flights cannot be turned into a no-results answer by an empty placeholder',async()=>{
  const page=await browser.newPage();
  try{
    await page.setContent('<main>Sorry, no available flights found</main>');
    await assert.rejects(waitForResults(page,new AbortController().signal,300,()=>{},25),(error:any)=>error.code==='PAGE_RENDER_INCONSISTENT');
  }finally{await page.close();}
});
test('search readiness waits for the full browser response and records the business result',async()=>{
  const page=await browser.newPage();
  const network=observeSearchNetwork(page);
  try{
    await page.route('**/*',async route=>{
      if(route.request().url().includes('FlightListSearchSSE')){
        await new Promise(resolve=>setTimeout(resolve,150));
        await route.fulfill({contentType:'text/event-stream',body:'data: {"head":{"retCode":"SUCCESS"},"basicInfo":{"recordCount":25}}\n\n'});
      }else await route.fulfill({contentType:'text/html',body:'<script>fetch("/restapi/soa2/27015/FlightListSearchSSE").then(r=>r.text())</script>'});
    });
    await page.goto('https://www.trip.com/');
    await network.waitForSearch(new AbortController().signal,3000);
    assert.equal(network.searchCompleted,true);assert.equal(network.pending,0);
    assert.equal(network.responses[0].retCode,'SUCCESS');assert.equal(network.responses[0].recordCount,25);
  }finally{network.dispose();await page.close();}
});

async function retryFixture(statuses:number[],challenge=false) {
  const page=await browser.newPage();const network=observeSearchNetwork(page);
  let requests=0;
  await page.route('**/*',async route=>{
    if(route.request().url().includes('FlightListSearchSSE')) {
      const status=statuses[Math.min(requests++,statuses.length-1)];
      await route.fulfill({status,contentType:'text/event-stream',body:status===200?'data: {"head":{"retCode":"SUCCESS"},"basicInfo":{"recordCount":25}}\n\n':'restricted'});
    } else await route.fulfill({contentType:'text/html',body:`<main>${challenge?'Verify that you are human':'Sorry, no available flights found'}</main><button onclick="runSearch()">Search</button><script>
      sessionStorage.loads=String(Number(sessionStorage.loads||0)+1);
      window.marker={};window.runSearch=()=>fetch('/restapi/soa2/27015/FlightListSearchSSE').then(r=>r.text());runSearch();
      </script>`});
  });
  await page.goto('https://www.trip.com/flights/showfarefirst');
  return {page,network,requests:()=>requests,close:async()=>{network.dispose();await page.close();}};
}
test('one same-page Search click recovers 430 without navigation or replacing the session',async()=>{
  const fixture=await retryFixture([430,200]);let retries=0;
  try {
    const marker=await fixture.page.evaluateHandle(()=>(window as any).marker);
    assert.equal(await completeSearchWithSamePageRetry(fixture.page,fixture.network,new AbortController().signal,3000,{allowRetry:true,delayMs:10,onRetry:async()=>{retries++;}}),true);
    assert.equal(retries,1);assert.equal(fixture.requests(),2);
    assert.deepEqual(fixture.network.responses.map(r=>[r.status,r.searchRound]),[[430,1],[200,2]]);
    assert.equal(fixture.network.error,undefined);assert.equal(fixture.network.responses[1].recordCount,25);
    assert.equal(await fixture.page.evaluate(()=>sessionStorage.loads),'1');
    assert.equal(await fixture.page.evaluate(marker=>marker===(window as any).marker,marker),true);
  }finally{await fixture.close();}
});
test('second 430 stops after exactly two requests',async()=>{
  const fixture=await retryFixture([430,430]);let retries=0;
  try{
    await assert.rejects(completeSearchWithSamePageRetry(fixture.page,fixture.network,new AbortController().signal,3000,{allowRetry:true,delayMs:10,onRetry:async()=>{retries++;}}),(e:any)=>e.code==='ACCESS_RESTRICTED'&&!e.retryable);
    assert.equal(retries,1);assert.equal(fixture.requests(),2);
    assert.deepEqual(fixture.network.responses.map(r=>r.status),[430,430]);
  }finally{await fixture.close();}
});
test('401, 403 and 429 never trigger the same-page recovery',async()=>{
  for(const status of [401,403,429]){
    const fixture=await retryFixture([status,200]);
    try{
      await assert.rejects(completeSearchWithSamePageRetry(fixture.page,fixture.network,new AbortController().signal,3000,{allowRetry:true,delayMs:10}),(e:any)=>e.code==='ACCESS_RESTRICTED');
      assert.equal(fixture.requests(),1);
    }finally{await fixture.close();}
  }
});
test('explicit human verification prevents recovery even after 430',async()=>{
  const fixture=await retryFixture([430,200],true);
  try{
    await assert.rejects(completeSearchWithSamePageRetry(fixture.page,fixture.network,new AbortController().signal,3000,{allowRetry:true,delayMs:10}),(e:any)=>e.code==='ACCESS_RESTRICTED');
    assert.equal(fixture.requests(),1);
  }finally{await fixture.close();}
});
test('exhausted attempt budget prevents same-page recovery',async()=>{
  const fixture=await retryFixture([430,200]);
  try{
    await assert.rejects(completeSearchWithSamePageRetry(fixture.page,fixture.network,new AbortController().signal,3000,{allowRetry:false,delayMs:10}),(e:any)=>e.code==='ACCESS_RESTRICTED');
    assert.equal(fixture.requests(),1);
  }finally{await fixture.close();}
});
