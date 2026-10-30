import type { Page } from 'playwright';
import { setTimeout as delay } from 'node:timers/promises';
import { FlightError } from '../../core/errors.js';
import type { Location, SearchQuery } from '../../core/types.js';
import type { CardData } from './parser.js';
import { locations,isMainlandRoute } from '../../core/locations.js';

export interface SearchNetwork { readonly round:number; searchPending:number; error?:FlightError; directFailure?:{code:string;pagePath:string}; responses:Array<{path:string;status:number;searchRound:number;observedAt:string;completedAt?:string;recordCount?:number;retCode?:string}>; pending:number; searchCompleted:boolean; lastSettledAt:number; check:()=>void; waitForSearch:(signal:AbortSignal,timeoutMs:number)=>Promise<void>; resetForResubmit:(mode?:'departure'|'return')=>void; dispose:()=>void }
export function summarizeMiddleResponse(body:string):{retCode:string;complete:boolean} {
  const value=JSON.parse(body);
  if(value.head?.retCode!=='SUCCESS') throw new FlightError('PROVIDER_ERROR',`Trip.com return search reported ${value.head?.retCode??'missing business status'}`);
  // Some incremental Middle responses contain metadata only. They do not
  // complete a search and cannot establish zero inventory.
  if(value.journeyList===undefined)return {retCode:'SUCCESS',complete:false};
  if(!Array.isArray(value.journeyList)) throw new FlightError('PROVIDER_RESPONSE_ERROR','Invalid return journeyList');
  return {retCode:'SUCCESS',complete:true};
}
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
export function summarizeJsonSearchResponse(body:string):{retCode:string;recordCount:number;complete:boolean} {
  const value=JSON.parse(body);
  if(value.head?.retCode!=='SUCCESS')throw new FlightError('PROVIDER_ERROR',`Trip.com search response reported ${value.head?.retCode??'missing business status'}`);
  const count=value.basicInfo?.recordCount;
  if(!((typeof count==='number'&&Number.isSafeInteger(count))||(typeof count==='string'&&/^\d+$/.test(count)))||Number(count)<0||!Number.isSafeInteger(Number(count))||!Array.isArray(value.itineraryList))throw new FlightError('PROVIDER_RESPONSE_ERROR','JSON flight response has no valid result count/itinerary list');
  const poll=value.basicInfo?.pollInterval;
  if(!Number.isInteger(poll)||poll< -1)throw new FlightError('PROVIDER_RESPONSE_ERROR','JSON flight response has no valid polling completion state');
  if(poll===-1&&((Number(count)===0)!==(value.itineraryList.length===0)))throw new FlightError('PROVIDER_RESPONSE_ERROR','Completed JSON flight count conflicts with its itineraries');
  return{retCode:'SUCCESS',recordCount:Number(count),complete:poll===-1};
}
export function observeSearchNetwork(page:Page,options:{resultsOnly?:boolean;quietMs?:number}={}):SearchNetwork {
  let generation=1;
  let returnSearch=false;
  let lastSearchSettledAt=0;
  const requestRounds=new WeakMap<import('playwright').Request,number>();
  const inFlight=new WeakMap<import('playwright').Request,{round:number;settled:boolean;search:boolean}>();
  const settle=(request:import('playwright').Request)=>{
    const tracked=inFlight.get(request);if(!tracked||tracked.settled)return;tracked.settled=true;
    if(tracked.round===generation){state.pending--;state.lastSettledAt=Date.now();if(tracked.search){state.searchPending--;lastSearchSettledAt=Date.now();}}
  };
  const requested=(request:import('playwright').Request)=>{
    if(options.resultsOnly&&request.isNavigationRequest()&&request.frame()===page.mainFrame()) {
      generation++;state.pending=0;state.searchPending=0;state.searchCompleted=false;state.lastSettledAt=0;lastSearchSettledAt=0;
      if(state.error?.code!=='ACCESS_RESTRICTED')state.error=undefined;
    }
    // The homepage preloads restored searches. Navigation can destroy those
    // response bodies; they are not evidence for this result-page query.
    if(options.resultsOnly&&!/^\/(?:chinaflights|flights)\/showfare(?:first|next)\/?$/i.test(new URL(page.url()).pathname))return;
    requestRounds.set(request,generation);
    const url=new URL(request.url());
    if(/(^|\.)trip\.com$/.test(url.hostname)&&/\/(?:FlightListSearch(?:SSE)?|FlightMiddleSearch)$/.test(url.pathname)) {
      const search=url.pathname.includes('FlightListSearch');
      inFlight.set(request,{round:generation,settled:false,search});state.pending++;
      if(search){state.searchPending++;state.searchCompleted=false;}
    }
  };
  const failed=(request:import('playwright').Request)=>{
    const tracked=inFlight.get(request);if(tracked?.round!==generation)return;
    settle(request);
    const message=request.failure()?.errorText??'Flight request failed';
    if(!page.isClosed()&&!message.includes('ERR_ABORTED'))state.error=new FlightError('NETWORK_ERROR',message,true);
  };
  const state:SearchNetwork={get round(){return generation;},responses:[],pending:0,searchPending:0,searchCompleted:false,lastSettledAt:0,
    check(){if(state.error)throw state.error;},
    resetForResubmit(mode='departure'){generation++;returnSearch=mode==='return';state.error=undefined;state.pending=0;state.searchPending=0;state.searchCompleted=false;state.lastSettledAt=0;lastSearchSettledAt=0;},
    async waitForSearch(signal,timeoutMs){
      const until=Date.now()+timeoutMs;
      while(Date.now()<until){
        signal.throwIfAborted();state.check();
        if(state.searchCompleted&&(returnSearch?state.pending:state.searchPending)===0&&Date.now()-(returnSearch?state.lastSettledAt:lastSearchSettledAt)>=(options.quietMs??500))return;
        await delay(100,undefined,{signal});
      }
      throw new FlightError('RESULTS_TIMEOUT','Fresh flight search response did not finish within the step deadline',true);
    },dispose(){generation++;page.off('request',requested);page.off('requestfailed',failed);page.off('response',listener);}};
  const listener=(response:import('playwright').Response)=>{
    const url=new URL(response.url());
    if(!/(^|\.)trip\.com$/.test(url.hostname)||!/\/(?:FlightListSearch(?:SSE)?|FlightMiddleSearch)$/.test(url.pathname))return;
    const round=requestRounds.get(response.request());
    if(round!==generation)return;
    const status=response.status();const record:SearchNetwork['responses'][number]={path:url.pathname,status,searchRound:round,observedAt:new Date().toISOString()};state.responses.push(record);
    const error=searchResponseError(status,url.pathname);
    if(error&&(!state.error||!error.retryable))state.error=error;
    if(status===200){
      void(async()=>{
        try{
          const transferError=await response.finished();if(transferError)throw transferError;
          if(round!==generation)return;
          if(url.pathname.includes('FlightListSearch')){
            const body=await response.text();
            if(round!==generation)return;
            const summary=url.pathname.endsWith('FlightListSearchSSE')?{...summarizeSearchResponse(body),complete:true}:summarizeJsonSearchResponse(body);record.retCode=summary.retCode;record.recordCount=summary.recordCount;
            state.searchCompleted=summary.complete;
            if(record.retCode&&record.retCode!=='SUCCESS')state.error=new FlightError('PROVIDER_ERROR',`Trip.com search response reported ${record.retCode}`);
          } else if(returnSearch&&url.pathname.includes('FlightMiddleSearch')) {
            const body=await response.text();
            if(round!==generation)return;
            const summary=summarizeMiddleResponse(body);
            record.retCode=summary.retCode;
            if(summary.complete)state.searchCompleted=true;
          }
          record.completedAt=new Date().toISOString();
        }catch(error){
          if(round===generation&&!page.isClosed())state.error=error instanceof FlightError?error:new FlightError('PROVIDER_RESPONSE_ERROR',`Could not finish reading flight response: ${error instanceof Error?error.message:String(error)}`);
        }finally{settle(response.request());}
      })();
    }else{void response.finished().then(()=>settle(response.request()),()=>settle(response.request()));}
  };
  page.on('request',requested);page.on('requestfailed',failed);page.on('response',listener);return state;
}
export async function clickSearch(page:Page):Promise<void> {
  await page.getByRole('button',{name:'Search',exact:true}).or(page.getByText('Search',{exact:true})).first().click();
}
export async function openSearchResults(page:Page):Promise<void> {
  // Result data has its own observed response/readiness checks. Waiting for the
  // document's default `load` also waits for unrelated images and third parties,
  // which can hang after the result URL and DOM have already arrived.
  await Promise.all([
    page.waitForURL(url=>url.hostname==='www.trip.com'&&url.pathname.includes('showfarefirst'),{waitUntil:'domcontentloaded'}),
    clickSearch(page),
  ]);
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
export async function openCandidate(page:Page,index:number,instanceKey?:string):Promise<void> {
  // Both observed page variants use this test ID; their labels differ between
  // "View Details" / "Select this fare" and "Select".
  if(instanceKey&&!/^[a-zA-Z0-9-]+$/.test(instanceKey))throw new FlightError('RESULTS_CHANGED','Invalid original card binding');
  const card=instanceKey?page.locator(`[data-flightor-card-key="${instanceKey}"]`):cards(page).nth(index);
  if(instanceKey&&await card.count()!==1)throw new FlightError('RESULTS_CHANGED','Original result card was replaced. Search again.');
  const row=card.locator('xpath=ancestor::*[.//*[@data-testid="u_select_btn"]][1]');
  await row.getByTestId('u_select_btn').first().click();
}
export async function readCards(page: Page,limit=Infinity): Promise<CardData[]> {
  return cards(page).evaluateAll((elements,limit) => {
    const state=window as unknown as {__flightorCards?:{keys:WeakMap<Element,string>;prefix:string;next:number}};
    const registry=state.__flightorCards??= {keys:new WeakMap(),prefix:`${Date.now()}-${Math.random().toString(36).slice(2)}`,next:0};
    return elements.slice(0,limit).map(el => {
    let instanceKey=registry.keys.get(el);
    if(!instanceKey){instanceKey=`${registry.prefix}-${++registry.next}`;registry.keys.set(el,instanceKey);}
    el.setAttribute('data-flightor-card-key',instanceKey);
    let row=el.parentElement;
    while(row&&!row.querySelector('[data-testid="u_select_btn"]'))row=row.parentElement;
    return {
    instanceKey,
    label: el.getAttribute('aria-label') ?? '', text: (el as HTMLElement).innerText,
    priceLabel: el.getAttribute('aria-label') ?? '',
    priceText: row?.innerText ?? '',
    airlineText: (el.querySelector('[role="region"]') as HTMLElement | null)?.innerText ?? '',
    airports: Array.from(el.querySelectorAll('[role="textbox"]')).map(t => ((t as HTMLElement).innerText.match(/\b[A-Z]{3}\b/) ?? [])[0]).filter((x):x is string=>!!x),
  };});},limit);
}
export async function chooseLocation(page: Page, id: string, location: Location) {
  const input=page.getByTestId(id).last();
  // The native popup reparents the editor and can cover inline Remove icons.
  // Use its normal empty-input Backspace interaction instead of clicking a
  // hidden/covered icon. Selection/deletion is debounced in the native picker;
  // pace keys and verify the chips are actually gone before entering a route.
  const wrapper=page.getByTestId(`${id}_wrapper`).last();
  const labels=wrapper.locator('[data-testid^="cityLabel_name_"]');
  await input.fill('');
  for(let step=0;await labels.count()>0;step++) {
    if(step>=30)throw new FlightError('QUERY_MISMATCH','Could not clear restored location chips');
    await input.press('Backspace',{delay:250});
  }
  await input.fill(location.code);
  if(location.kind==='city') {
    const escaped=location.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const cityName=new RegExp(`^${escaped}\\s*·?\\s*All airports\\b`,'i');
    const choices=page.getByRole('button',{name:/All airports\b/i});
    await choices.first().waitFor({state:'visible'});
    // London is also a city in Canada, and substring matching includes East
    // London. Match the city row's airport metadata before choosing a title.
    const rows=await choices.evaluateAll(elements=>elements.map((element,index)=>{
      const row=element.closest('li')??element;
      const metadata=Array.from(row.querySelectorAll('[data-value]')).flatMap(node=>{
        try {const value=JSON.parse(node.getAttribute('data-value')??'{}');return [{cityCode:value.cityCode,airportCode:value.airportCode}];} catch {return [];}
      });
      return {index,label:element.textContent??'',metadata};
    }));
    const matches=rows.filter(row=>row.metadata.some(value=>location.airports.includes(value.airportCode)));
    const named=rows.filter(row=>cityName.test(row.label));
    const selected=matches.length===1?matches[0]:matches.length===0&&named.length===1&&named[0].metadata.length===0?named[0]:null;
    if(!selected)throw new FlightError('LOCATION_SELECTION_FAILED',`Cannot uniquely match Trip.com city candidates to ${location.code} and its airports`);
    await choices.nth(selected.index).click();
  } else {
    await page.getByText(new RegExp(`^${location.code}\\s`)).last().click();
  }
  // The native picker can fetch metadata before rendering the selected chip.
  // A click finishing does not imply that React has applied that selection.
  await wrapper.locator('[data-testid^="cityLabel_name_"]').first().waitFor({state:'visible'});
  if(await wrapper.locator('[data-testid^="cityLabel_name_"]').count()!==1)
    throw new FlightError('QUERY_MISMATCH','Location control must contain exactly one selected city or airport');
}
export async function chooseDepartureDate(page:Page,departureDate:string,signal:AbortSignal, direction:'depart'|'return'='depart'):Promise<void> {
  signal.throwIfAborted();
  // Round-trip calendars can stay open and advance to return selection after
  // choosing departure. Clicking the date field again can close that calendar.
  if(direction==='depart'||!await page.getByRole('grid').first().isVisible()) {
    await page.getByRole('group',{name:direction==='depart'?/^Depart:/:/^Return:/}).first().click();
  }
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
  const selectedDate=await page.getByTestId(`search_date_${direction}0`).getAttribute('data-date');
  if(selectedDate!==departureDate)throw new FlightError('QUERY_MISMATCH','Date control does not match the requested departure date');
}
export async function choosePassengers(page:Page,adults:number,signal:AbortSignal):Promise<void> {
  signal.throwIfAborted();
  if(!Number.isInteger(adults)||adults<1||adults>9)throw new FlightError('INVALID_ARGUMENTS','Adults must be between 1 and 9');
  await page.getByTestId('passengers_total_num').last().click();
  for(const [type,target] of [['ChildCount',0],['BabyCount',0],['AdultCount',adults]] as const) {
    const plus=page.getByTestId(`${type}_plus`).last(),row=plus.locator('..');
    await plus.waitFor({state:'visible'});
    for(let step=0;step<10;step++) {
      signal.throwIfAborted();
      const current=Number((await row.innerText()).trim());
      if(!Number.isInteger(current))throw new FlightError('PAGE_CHANGED','Cannot read passenger count');
      if(current===target)break;
      if(step===9)throw new FlightError('QUERY_MISMATCH','Passenger control did not reach the requested count');
      const direction=current<target?'plus':'minus',next=current+(direction==='plus'?1:-1);
      const control=page.getByTestId(`${type}_${direction}`).last();
      if(/\bdisable\b/.test(await control.getAttribute('class')??''))throw new FlightError('INVALID_ARGUMENTS','Passenger count is outside the available website range');
      await control.click();
      await row.getByText(String(next),{exact:true}).waitFor({state:'visible'});
    }
  }
  if((await page.getByTestId('selected_cabin').last().innerText()).trim()!=='Economy') {
    await page.getByTestId('selected_cabin').last().click();
    await page.getByTestId('cabin_Y').last().click();
  }
  await page.getByTestId('passengers_total_num').last().click();
  const label=(await page.getByTestId('passengers_total_num').last().innerText()).trim();
  if(!new RegExp(`^${adults} adults?\\s*·\\s*Economy$`).test(label))throw new FlightError('QUERY_MISMATCH','Passenger summary differs from the requested adult count/cabin');
}
export async function submitSearch(page: Page, query: SearchQuery, resolved: {origin:Location;destination:Location}, signal: AbortSignal) {
  const response=await page.goto(`https://www.trip.com/flights/?locale=en-XX&curr=${query.currency}`,{waitUntil:'domcontentloaded'});
  assertNoAccessBlock(await page.locator('body').innerText());
  if(response && response.status()>=500) throw new FlightError('NETWORK_ERROR',`Trip.com returned HTTP ${response.status()}`,true);
  if(response?.status()===429 || response?.status()===403) throw new FlightError('ACCESS_RESTRICTED',`Trip.com returned HTTP ${response.status()}`,false,'needs_user_action');
  signal.throwIfAborted();
  await page.getByRole('radio',{name:query.tripType==='round_trip'?'Round-trip':'One-way',exact:true}).click();
  await chooseLocation(page,'search_city_from0',resolved.origin);
  await chooseLocation(page,'search_city_to0',resolved.destination);
  await chooseDepartureDate(page,query.departureDate,signal);
  if(query.tripType==='round_trip') await chooseDepartureDate(page,query.returnDate!,signal,'return');
  await choosePassengers(page,query.adults,signal);
  await openSearchResults(page);
  verifyUrl(page.url(),query,resolved);
}
export function directSearchUrl(query:SearchQuery,resolved:{origin:Location;destination:Location}):string {
  const url=new URL(isMainlandRoute(resolved.origin,resolved.destination)?'https://www.trip.com/chinaflights/showfarefirst':'https://www.trip.com/flights/showfarefirst');
  for(const [side,location] of [['d',resolved.origin],['a',resolved.destination]] as const) {
    const city=location.kind==='city'?location:locations.find(item=>item.kind==='city'&&item.airports.includes(location.code));
    url.searchParams.set(`${side}city`,(city?.code??location.code).toLowerCase());
    if(location.kind==='airport')url.searchParams.set(`${side}airport`,location.code.toLowerCase());
  }
  for(const [key,value] of Object.entries({ddate:query.departureDate,...(query.tripType==='round_trip'?{rdate:query.returnDate!}:{}),triptype:query.tripType==='round_trip'?'rt':'ow',class:'y',quantity:String(query.adults),curr:query.currency,locale:'en-XX'}))url.searchParams.set(key,value);
  verifyUrl(url.toString(),query,resolved);
  return url.toString();
}
// A normal navigation/readiness failure may fall back to the native form.
// Restrictions and human-verification pages always stop automated attempts.
export async function tryDirectSearch(page:Page,query:SearchQuery,resolved:{origin:Location;destination:Location},signal:AbortSignal,network:SearchNetwork,timeoutMs:number):Promise<boolean> {
  try {
    signal.throwIfAborted();
    const response=await page.goto(directSearchUrl(query,resolved),{waitUntil:'domcontentloaded',timeout:timeoutMs});
    assertNoAccessBlock(await page.locator('body').innerText());
    const error=response?searchResponseError(response.status(),new URL(page.url()).pathname):undefined;
    if(error)throw error;
    verifyUrl(page.url(),query,resolved);
    await network.waitForSearch(signal,timeoutMs);
    return true;
  } catch(error) {
    signal.throwIfAborted();
    if(network.error?.code==='ACCESS_RESTRICTED')throw network.error;
    if(error instanceof FlightError&&error.code==='ACCESS_RESTRICTED')throw error;
    assertNoAccessBlock(await page.locator('body').innerText());
    network.directFailure={code:error instanceof FlightError?error.code:error instanceof Error&&error.name==='TimeoutError'?'TIMEOUT':'NAVIGATION_ERROR',pagePath:new URL(page.url()).pathname};
    network.resetForResubmit();
    return false;
  }
}
export function verifyUrl(value: string,query:SearchQuery,resolved:{origin:Location;destination:Location}) {
  const url=new URL(value);
  if(url.hostname!=='www.trip.com'||!/^\/(?:chinaflights|flights)\/showfare(?:first|next)\/?$/i.test(url.pathname)||/showfarenext/i.test(url.pathname)&&query.tripType!=='round_trip')throw new FlightError('QUERY_MISMATCH','Trip.com did not open its flight results page');
  for(const [side,location] of [['d',resolved.origin],['a',resolved.destination]] as const) {
    const city=url.searchParams.get(`${side}city`)?.toUpperCase();
    const airports=(url.searchParams.get(`${side}airport`)??'').toUpperCase().split(',').filter(Boolean);
    if(location.kind==='airport') {
      // Trip.com represents a specific airport as its parent city plus an
      // explicit airport filter, e.g. acity=tyo&aairport=hnd.
      if(!city||airports.length!==1||airports[0]!==location.code)throw new FlightError('QUERY_MISMATCH',`Trip.com ${side}airport differs from the requested airport`);
    } else if(city!==location.code||(airports.length>0&&(airports.length!==location.airports.length||location.airports.some(code=>!airports.includes(code))))) {
      throw new FlightError('QUERY_MISMATCH',`Trip.com ${side}city differs from the requested city scope`);
    }
  }
  for(const [key,expected] of Object.entries({ddate:query.departureDate,...(query.tripType==='round_trip'?{rdate:query.returnDate!}:{}),triptype:query.tripType==='round_trip'?'rt':'ow',class:'y',quantity:String(query.adults),curr:query.currency})) {
    if(url.searchParams.get(key)?.toLowerCase()!==expected.toLowerCase()) throw new FlightError('QUERY_MISMATCH',`Trip.com search parameter ${key} differs from the request`);
  }
}
export function publicSearchUrl(value:string):string {
  const source=new URL(value),url=new URL(source.pathname.startsWith('/chinaflights/')?'https://www.trip.com/chinaflights/showfarefirst':'https://www.trip.com/flights/showfarefirst');
  for(const key of ['dcity','acity','dairport','aairport','ddate','rdate','triptype','class','quantity','curr','locale']) {
    const value=source.searchParams.get(key);if(value!==null)url.searchParams.set(key,value);
  }
  return url.toString();
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
export async function sortAndStabilize(page: Page,signal:AbortSignal,timeoutMs:number,check:()=>void=()=>{},quietMs=1500,network?:SearchNetwork,limit=Infinity,expectedCount?:number): Promise<boolean> {
  check();
  const tab=page.getByRole('tab',{name:'Cheapest',exact:true});
  await tab.waitFor({state:'visible',timeout:timeoutMs});
  if(await tab.getAttribute('aria-selected')!=='true')await tab.click({timeout:timeoutMs});
  await page.waitForFunction(()=>document.querySelector('[role="tab"][aria-label="Cheapest"]')?.getAttribute('aria-selected')==='true',undefined,{timeout:timeoutMs});
  let previous='',stableSince=Date.now(); const until=Date.now()+timeoutMs;
  const required=expectedCount===undefined?1:Math.max(1,Math.min(limit,expectedCount));
  while(Date.now()<until) {
    signal.throwIfAborted(); assertNoAccessBlock(await page.locator('body').innerText());
    check();
    const data=await readCards(page,limit);
    const fingerprint=JSON.stringify(data);
    if(fingerprint!==previous||network&&(network.searchPending>0||!network.searchCompleted)) { previous=fingerprint;stableSince=Date.now(); }
    if(data.length>=required && Date.now()-stableSince>=quietMs) return true;
    await delay(Math.min(100,quietMs),undefined,{signal});
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
export async function stableFareText(page:Page,signal:AbortSignal,timeoutMs:number,network:SearchNetwork,quietMs=1000):Promise<string> {
  let previous='',since=Date.now();const until=Date.now()+timeoutMs;
  while(Date.now()<until) {
    signal.throwIfAborted();network.check();
    const text=await page.locator('.ift-drawer[aria-hidden="false"]').innerText();
    assertNoAccessBlock(text);
    if(text!==previous||network.pending>0){previous=text;since=Date.now();}
    if(text.includes('Select Fare')&&/^\s*[A-Z0-9]{2}\d{1,4}[A-Z]?\s*$/m.test(text)&&Date.now()-since>=quietMs)return text;
    await delay(Math.min(100,quietMs),undefined,{signal});
  }
  throw new FlightError('RESULTS_TIMEOUT','Fare details did not stabilize within the step budget');
}
