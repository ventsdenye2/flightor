import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {readCards,openCandidate,observeSearchNetwork} from '../src/providers/trip/browser.js';
import {parseCard,bindCandidateIdentities} from '../src/providers/trip/parser.js';
import {readCandidateDetails} from '../src/providers/trip/details.js';
import {searchInputSchema} from '../src/core/types.js';

test('identical summaries open their original card after reorder, validate C919 details, and refuse replaced cards or changed flights',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
  const dir=await mkdtemp(join(tmpdir(),'similar-flight-'));
  const query=searchInputSchema.parse({origin:'PVG',destination:'LIS',departureDate:'2026-11-04',currency:'CNY'});
  const text=await readFile(new URL('./fixtures/c919-details.txt',import.meta.url),'utf8');
  const row=(key:string)=>`<article id="${key}"><div role="group" aria-label="Flight departing from Shanghai at 2026-11-04 16:05:00 and arriving at Lisbon at 2026-11-05 15:05:00. One-way price: CNY 3,263"><span role="region">China Eastern Airlines, TAP Air Portugal</span><span role="textbox">PVG</span><span role="textbox">LIS</span><div>2 stops in Xi'an, Vienna</div></div><div>CNY 3,263</div><button data-testid="u_select_btn">Select</button></article>`;
  try {
    await page.setContent(`<main>${row('a')}${row('b')}</main><section class="ift-drawer" aria-hidden="true" hidden><pre class="m-middle-flightInfo"></pre><div>Select Fare</div><pre class="fare"></pre><button aria-label="Close">Close</button></section>`);
    await page.evaluate(text=>{
      const drawer=document.querySelector<HTMLElement>('.ift-drawer')!;
      for(const id of ['a','b'])document.querySelector<HTMLButtonElement>(`#${id} button`)!.onclick=()=>{
        const [itinerary,fare]=text.replace('MU2162',id==='a'?'MU2162':document.body.dataset.flight||'MU2164').split('Select Fare');
        drawer.querySelector('.m-middle-flightInfo')!.textContent=itinerary;drawer.querySelector('.fare')!.textContent=fare;
        drawer.hidden=false;drawer.setAttribute('aria-hidden','false');document.body.dataset.selected=id;
      };
      drawer.querySelector('button')!.onclick=()=>{drawer.hidden=true;drawer.setAttribute('aria-hidden','true');};
    },text);
    const ambiguous=new Set<string>();
    const readCandidates=async()=>{const rows=await readCards(page);return bindCandidateIdentities(rows.map(row=>parseCard(row,query)),rows,ambiguous);};
    const initial=await readCandidates();assert.equal(initial.length,2);assert.notEqual(initial[0].id,initial[1].id);
    await page.evaluate(()=>document.querySelector('main')!.prepend(document.getElementById('b')!));
    // Even the old index cannot redirect a binding to the other identical row.
    await openCandidate(page,1,initial[1].cardKey);assert.equal(await page.locator('body').getAttribute('data-selected'),'b');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    const network=observeSearchNetwork(page);network.searchCompleted=true;
    try {
      const options={page,network,query,candidate:initial[1],readCandidates,dir,signal:new AbortController().signal,timeoutMs:2000,quietMs:20};
      const detail=await readCandidateDetails(options);
      assert.deepEqual(detail.details!.segments.map(s=>s.flightNumber),['MU2164','MU5063','TP1271']);
      assert.equal(await page.locator('body').getAttribute('data-selected'),'b');
      await page.evaluate(()=>{document.body.dataset.flight='MU2999';});
      await assert.rejects(readCandidateDetails({...options,candidate:detail}),(e:any)=>e.code==='DETAILS_MISMATCH');
      await page.evaluate(()=>{const old=document.getElementById('b')!;old.replaceWith(old.cloneNode(true));});
      await assert.rejects(readCandidateDetails(options),(e:any)=>e.code==='RESULTS_CHANGED');
    } finally {network.dispose();}
  } finally {await browser.close();await rm(dir,{recursive:true,force:true});}
});
