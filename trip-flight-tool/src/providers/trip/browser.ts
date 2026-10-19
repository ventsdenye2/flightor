import type { Page } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { FlightError } from '../../core/errors.js';
import type { Location, SearchQuery } from '../../core/types.js';
import type { CardData } from './parser.js';

export interface SearchNetwork { error?:FlightError; responses:Array<{path:string;status:number;searchRound:number;observedAt:string;completedAt?:string;recordCount?:number;retCode?:string}>; pending:number; searchCompleted:boolean; lastSettledAt:number; check:()=>void; waitForSearch:(signal:AbortSignal,timeoutMs:number)=>Promise<void>; resetForResubmit:()=>void; dispose:()=>void }
export function summarizeSearchResponse(body:string):{retCode:string;recordCount:number} {
  let retCode:string|undefined,recordCount:number|undefined;
  for(const line of body.split('\n')){
    const json=line.replace(/^data:\s*/,'').trim();if(!json.startsWith('{'))continue;
    let value:{head?:{retCode?:string};basicInfo?:{recordCount?:number|string}};
    try{value=JSON.parse(json);}catch{throw new FlightError('PROVIDER_RESPONSE_ERROR','Flight stream contains malformed JSON');}
    if(value.head?.retCode)retCode=value.head.retCode;
    if(value.basicInfo?.recordCount!==undefined){const count=Number(value.basicInfo.recordCount);if(Number.isSafeInteger(count)&&count>=0)recordCount=count;}
  }
  if(!retCode||recordCount===undefined)throw new FlightError('PROVIDER_RESPONSE_ERROR','Completed flight stream did not contain a business status and result count');
  if(retCode!=='SUCCESS')throw new FlightError('PROVIDER_ERROR',`Trip.com search response reported ${retCode}`);
  return{retCode,recordCount};
}
export function observeSearchNetwork(page:Page):SearchNetwork {
  let generation=1;
  const state:SearchNetwork={responses:[],pending:0,searchCompleted:false,lastSettledAt:0,
    check(){if(state.error)throw state.error;},
    resetForResubmit(){generation++;state.error=undefined;state.pending=0;state.searchCompleted=false;state.lastSettledAt=0;},
    async waitForSearch(signal,timeoutMs){
      const until=Date.now()+timeoutMs;
      while(Date.now()<until){
        signal.throwIfAborted();state.check();
        if(state.searchCompleted&&state.pending===0&&Date.now()-state.lastSettledAt>=500)return;
        await delay(100,undefined,{signal});
      }
      throw new FlightError('RESULTS_TIMEOUT','Fresh flight search response did not finish within the step deadline',true);
    },dispose(){generation++;page.off('response',listener);}};
  const listener=(response:import('playwright').Response)=>{
    const url=new URL(response.url());
    if(!/(^|\.)trip\.com$/.test(url.hostname)||!/FlightListSearchSSE|FlightMiddleSearch/.test(url.pathname))return;
    const round=generation;
    const status=response.status();const record:SearchNetwork['responses'][number]={path:url.pathname,status,searchRound:round,observedAt:new Date().toISOString()};state.responses.push(record);
    const error=searchResponseError(status,url.pathname);
    if(error&&(!state.error||!error.retryable))state.error=error;
    if(status===200){
      state.pending++;
      void(async()=>{
        try{
          await response.finished();
          if(round!==generation)return;
          if(url.pathname.includes('FlightListSearchSSE')){
            const body=await response.text();
            if(round!==generation)return;
            const summary=summarizeSearchResponse(body);record.retCode=summary.retCode;record.recordCount=summary.recordCount;
            state.searchCompleted=true;
            if(record.retCode&&record.retCode!=='SUCCESS')state.error=new FlightError('PROVIDER_ERROR',`Trip.com search response reported ${record.retCode}`);
          }
          record.completedAt=new Date().toISOString();
        }catch(error){
          if(round===generation&&!page.isClosed())state.error=error instanceof FlightError?error:new FlightError('PROVIDER_RESPONSE_ERROR',`Could not finish reading flight response: ${error instanceof Error?error.message:String(error)}`);
        }finally{if(round===generation){state.pending--;state.lastSettledAt=Date.now();}}
      })();
    }
  };
  page.on('response',listener);return state;
}
export async function clickSearch(page:Page):Promise<void> {
  await page.getByRole('button',{name:'Search',exact:true}).or(page.getByText('Search',{exact:true})).first().click();
}
export async function completeSearchWithSamePageRetry(page:Page,network:SearchNetwork,signal:AbortSignal,timeoutMs:number,options:{allowRetry:boolean;onRetry?:()=>Promise<void>;delayMs?:number}):Promise<boolean> {
  try {await network.waitForSearch(signal,timeoutMs);return false;}
  catch(error) {
    const latest=network.responses.filter(r=>r.path.includes('FlightListSearchSSE')).at(-1);
    const hardRestriction=network.responses.some(r=>[401,403,429].includes(r.status));
    if(!options.allowRetry||!(error instanceof FlightError)||error.code!=='ACCESS_RESTRICTED'||latest?.status!==430||hardRestriction)throw error;
    assertNoAccessBlock(await page.locator('body').innerText());
    await delay(options.delayMs??2000,undefined,{signal});
    assertNoAccessBlock(await page.locator('body').innerText());
    signal.throwIfAborted();
    await options.onRetry?.();
    network.resetForResubmit();
    // Same page and context: no navigation, reload, or fresh browser session.
    await clickSearch(page);
    await network.waitForSearch(signal,timeoutMs);
    return true;
  }
}
export function searchResponseError(status:number,path:string):FlightError|undefined {
  if([401,403,429,430].includes(status))return new FlightError('ACCESS_RESTRICTED',`Trip.com flight search returned HTTP ${status} at ${path}. The page may misleadingly display no flights. Stop automated attempts.`,false,'needs_user_action');
  if(status>=500)return new FlightError('NETWORK_ERROR',`Trip.com flight search returned HTTP ${status} at ${path}`,true);
  if(status>=400)return new FlightError('PROVIDER_ERROR',`Trip.com flight search returned HTTP ${status} at ${path}`);
}

export function assertNoAccessBlock(text: string): void {
  if (/whaleguard\s+block|verify (?:that )?you are human|unusual traffic|access denied|complete (?:the )?(?:security|captcha) verification|滑动.*验证|访问受限/i.test(text))
    throw new FlightError('ACCESS_RESTRICTED','Trip.com requires human verification or has restricted this browser. Stop automated attempts; inspect the diagnostic screenshot.',false,'needs_user_action');
}
export const cards = (page: Page) => page.getByRole('group',{name:/^Flight departing from /});
export async function openCandidate(page:Page,index:number):Promise<void> {
  // Both observed page variants use this test ID; their labels differ between
  // "View Details" / "Select this fare" and "Select".
  const row=cards(page).nth(index).locator('xpath=ancestor::*[.//*[@data-testid="u_select_btn"]][1]');
  await row.getByTestId('u_select_btn').first().click();
}
export async function readCards(page: Page): Promise<CardData[]> {
  return cards(page).evaluateAll(elements => elements.map(el => ({
    label: el.getAttribute('aria-label') ?? '', text: (el as HTMLElement).innerText,
    priceLabel: el.getAttribute('aria-label') ?? '',
    airlineText: (el.querySelector('[role="region"]') as HTMLElement | null)?.innerText ?? '',
    airports: Array.from(el.querySelectorAll('[role="textbox"]')).map(t => ((t as HTMLElement).innerText.match(/\b[A-Z]{3}\b/) ?? [])[0]).filter((x):x is string=>!!x),
  })));
}
export async function chooseLocation(page: Page, id: string, location: Location) {
  const input=page.getByTestId(id).last();
  await input.fill(location.code);
  // Filling the combobox does not replace cities restored from local storage.
  const wrapper=page.getByTestId(`${id}_wrapper`).last();
  const labels=wrapper.locator('[data-testid^="cityLabel_name_"]');
  for(let i=await labels.count()-1;i>=0;i--) {
    await input.fill(location.code);
    await wrapper.getByTestId(`cityLabel_delete_${i}`).click();
  }
  await input.fill(location.code);
  if(location.kind==='city') {
    const escaped=location.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    await page.getByRole('button',{name:new RegExp(`${escaped}.*All airports`,'i')}).click();
  } else {
    await page.getByText(new RegExp(`^${location.code}\\s`)).last().click();
  }
  if(await wrapper.locator('[data-testid^="cityLabel_name_"]').count()!==1)
    throw new FlightError('QUERY_MISMATCH','Location control must contain exactly one selected city or airport');
}
export async function chooseDepartureDate(page:Page,departureDate:string,signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();
  await page.getByRole('group',{name:/^Depart:/}).first().click();
  await page.getByRole('grid').first().waitFor({state:'visible'});
  const date=new Date(`${departureDate}T12:00:00Z`);
  const label=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date);
  const targetMonth=date.getUTCFullYear()*12+date.getUTCMonth();
  const monthNames=Array.from({length:12},(_,month)=>new Intl.DateTimeFormat('en-US',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2000,month,1))));
  const choice=page.getByRole('grid').getByRole('checkbox',{name:label,exact:false});
  const visited=new Set<string>();
  while(!await choice.isVisible()) {
    signal.throwIfAborted();
    const labels=await page.getByRole('grid').evaluateAll(grids=>grids.map(grid=>grid.getAttribute('aria-label')??''));
    const signature=JSON.stringify(labels);
    const months=labels.map(value=>{
      const match=/^([A-Za-z]+)\s+(\d{4})$/.exec(value.trim());
      const month=match?monthNames.indexOf(match[1]):-1;
      if(!match||month<0)throw new FlightError('PAGE_CHANGED',`Unrecognized calendar month: ${value}`);
      return Number(match[2])*12+month;
    });
    if(!months.length)throw new FlightError('PAGE_CHANGED','Calendar has no visible month grids');
    if(months.includes(targetMonth)) {await choice.waitFor({state:'visible'});break;}
    if(visited.has(signature)||visited.size>=24)throw new FlightError('PAGE_CHANGED','Calendar navigation did not reach the requested month');
    visited.add(signature);
    // Saved searches may open a later month; compare year and month before navigating.
    const direction=targetMonth<Math.min(...months)?'previous':targetMonth>Math.max(...months)?'next':null;
    if(!direction)throw new FlightError('PAGE_CHANGED','Calendar month grids are not contiguous');
    const navigation=page.getByRole('button',{name:`Go to ${direction} month`,exact:true});
    if(!await navigation.isEnabled())throw new FlightError('INVALID_ARGUMENTS',`Departure date ${departureDate} is outside the available Trip.com calendar window`);
    await navigation.click();
    await page.waitForFunction(previous=>{
      const labels=Array.from(document.querySelectorAll('[role=grid]')).filter(grid=>{
        const style=getComputedStyle(grid);return grid.getClientRects().length>0&&style.visibility!=='hidden'&&style.display!=='none';
      }).map(grid=>grid.getAttribute('aria-label')??'');
      return labels.length>0&&JSON.stringify(labels)!==previous;
    },signature);
  }
  signal.throwIfAborted();
  if(await choice.isDisabled())throw new FlightError('INVALID_ARGUMENTS','Departure date is unavailable in Trip.com calendar');
  await choice.click();
  const selectedDate=await page.getByTestId('search_date_depart0').getAttribute('data-date');
  if(selectedDate!==departureDate)throw new FlightError('QUERY_MISMATCH','Date control does not match the requested departure date');
}
export async function submitSearch(page: Page, query: SearchQuery, resolved: {origin:Location;destination:Location}, signal: AbortSignal) {
  const response=await page.goto(`https://www.trip.com/flights/?locale=en-XX&curr=${query.currency}`,{waitUntil:'domcontentloaded'});
  assertNoAccessBlock(await page.locator('body').innerText());
  if(response && response.status()>=500) throw new FlightError('NETWORK_ERROR',`Trip.com returned HTTP ${response.status()}`,true);
  if(response?.status()===429 || response?.status()===403) throw new FlightError('ACCESS_RESTRICTED',`Trip.com returned HTTP ${response.status()}`,false,'needs_user_action');
  signal.throwIfAborted();
  await page.getByRole('radio',{name:'One-way',exact:true}).click();
  await chooseLocation(page,'search_city_from0',resolved.origin);
  await chooseLocation(page,'search_city_to0',resolved.destination);
  await chooseDepartureDate(page,query.departureDate,signal);
  await clickSearch(page);
  await page.waitForURL(url=>url.pathname.includes('showfarefirst'));
  verifyUrl(page.url(),query,resolved);
}
export function verifyUrl(value: string,query:SearchQuery,resolved:{origin:Location;destination:Location}) {
  const url=new URL(value);
  for(const [key,expected] of Object.entries({dcity:resolved.origin.code.toLowerCase(),acity:resolved.destination.code.toLowerCase(),ddate:query.departureDate,triptype:'ow',class:'y',quantity:String(query.adults),curr:query.currency})) {
    if(url.searchParams.get(key)?.toLowerCase()!==expected.toLowerCase()) throw new FlightError('QUERY_MISMATCH',`Trip.com search parameter ${key} differs from the request`);
  }
}
export async function waitForResults(page: Page,signal:AbortSignal,timeoutMs:number,check:()=>void=()=>{},expectedCount?:number): Promise<'results'|'no_results'> {
  const until=Date.now()+timeoutMs;
  while(Date.now()<until) {
    signal.throwIfAborted();
    check();
    const text=await page.locator('body').innerText(); assertNoAccessBlock(text);
    if(expectedCount!==0&&await cards(page).count()>0) return 'results';
    if((expectedCount===undefined||expectedCount===0)&&/No flights (?:available|found)|We couldn.t find any flights|Sorry, no (?:available )?flights(?: found)?/i.test(text)) return 'no_results';
    await delay(300,undefined,{signal});
  }
  if(expectedCount&&expectedCount>0)throw new FlightError('PAGE_RENDER_INCONSISTENT',`The successful search response contains ${expectedCount} flights, but the page did not render them within the deadline`);
  throw new FlightError('RESULTS_TIMEOUT','Flight results did not become available within the step deadline',true);
}
export async function sortAndStabilize(page: Page,signal:AbortSignal,timeoutMs:number,check:()=>void=()=>{}): Promise<boolean> {
  check();
  const tab=page.getByRole('tab',{name:'Cheapest',exact:true});
  await tab.waitFor({state:'visible',timeout:timeoutMs});
  if(await tab.getAttribute('aria-selected')!=='true')await tab.click({timeout:timeoutMs});
  await page.waitForFunction(()=>document.querySelector('[role="tab"][aria-label="Cheapest"]')?.getAttribute('aria-selected')==='true',undefined,{timeout:timeoutMs});
  let previous='',stableSince=Date.now(); const until=Date.now()+timeoutMs;
  while(Date.now()<until) {
    signal.throwIfAborted(); assertNoAccessBlock(await page.locator('body').innerText());
    check();
    const data=await readCards(page);
    const fingerprint=JSON.stringify(data);
    if(fingerprint!==previous) { previous=fingerprint;stableSince=Date.now(); }
    if(data.length>0 && Date.now()-stableSince>=1500) return true;
    await delay(300,undefined,{signal});
  }
  if(!(await cards(page).count()))throw new FlightError('RESULTS_CHANGED','The sorted results did not return before the rendering deadline; no cheapest fare was published',false);
  return false;
}
export async function closeDetails(page: Page): Promise<void> {
  const close=page.getByRole('button',{name:/^Close$/i});
  if(await close.count()===1) { await close.click();return; }
  const testClose=page.locator('[class*="drawer"] [class*="close"], [class*="Drawer"] [class*="close"], [class*="detail"] [class*="close"]').filter({visible:true});
  if(await testClose.count()) { await testClose.first().click();return; }
  throw new FlightError('PAGE_CHANGED','Cannot safely locate the fare details close control');
}
