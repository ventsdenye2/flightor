import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Page} from 'playwright';
import type {Candidate,SearchQuery} from '../../core/types.js';
import {FlightError} from '../../core/errors.js';
import {assertNoAccessBlock,closeDetails,openCandidate,stableFareText,type SearchNetwork} from './browser.js';
import {parseAmount,parseDetails,parseRoundTripDetails,validateDetails} from './parser.js';

export function assertSamePrice(expected:Candidate,current:Candidate):void {
  if(expected.price.amount!==current.price.amount||expected.price.currency!==current.price.currency||
    (expected.price.totalAmount!==undefined&&current.price.totalAmount!==undefined&&expected.price.totalAmount!==current.price.totalAmount))
    throw new FlightError('PRICE_CHANGED','Selected flight price changed. Search again before choosing.');
}

// A drawer can offer a cheaper/different fare before the still-available list
// quote. Match the displayed per-adult price AND explicit group total, keeping
// baggage tied to that fare rather than borrowing the first card's allowance.
export function quotedFare(text:string,query:SearchQuery,candidate:Candidate,cards:string[]=[],allowReprice=false):{text:string;amount:number;total?:number} {
  const marker=text.indexOf('Select Fare');
  if(marker<0)throw new FlightError('PAGE_CHANGED','Fare heading is missing');
  const normalize=(value:string)=>value.replace(/\s+/g,' ').trim();
  const offers=cards.length?cards:[text.slice(marker)];
  const parsed=offers.map(offer=>{
    if(!normalize(text).includes(normalize(offer)))throw new FlightError('RESULTS_CHANGED','Fare cards changed after stabilization');
    const amount=parseAmount(offer,query.currency);
    const totalLine=offer.split('\n').find(line=>/^Total\s/i.test(line.trim()));
    const total=totalLine?parseAmount(totalLine,query.currency):undefined;
    if(query.adults>1&&total===undefined)throw new FlightError('PAGE_CHANGED','Fare drawer is missing the passenger total');
    return {text:offer,amount,...(total!==undefined?{total}:{})};
  });
  const matches=parsed.filter(offer=>offer.amount===candidate.price.amount&&(candidate.price.totalAmount===undefined||offer.total===candidate.price.totalAmount));
  // Preserve the existing first-fare behavior when it matches. If it does not,
  // a later match must be unique; price alone cannot disambiguate two brands.
  if(matches[0]===parsed[0]||matches.length===1)return matches[0];
  if(matches.length>1)throw new FlightError('PRICE_CHANGED','Quoted fare is ambiguous across multiple fare options. Search again.');
  if(allowReprice)return parsed[0];
  throw new FlightError('PRICE_CHANGED','No displayed fare matches the selected per-adult quote and passenger total. Search again.');
}

export async function readCandidateDetails({page,network,query,candidate,readCandidates,dir,signal,timeoutMs,quietMs=1000,allowReprice=false,warnings=[]}:{
  page:Page;network:SearchNetwork;query:SearchQuery;candidate:Candidate;readCandidates:()=>Promise<Candidate[]>;dir:string;signal:AbortSignal;timeoutMs:number;quietMs?:number;allowReprice?:boolean;warnings?:string[];
}):Promise<Candidate> {
  signal.throwIfAborted();network.check();
  const current=await readCandidates(),matches=current.map((item,index)=>({item,index})).filter(({item})=>item.id===candidate.id);
  if(matches.length!==1)throw new FlightError('RESULTS_CHANGED','Selected flight is no longer uniquely present. Search again.');
  assertSamePrice(candidate,matches[0].item);
  const checked=structuredClone(candidate);
  try {
    await openCandidate(page,matches[0].index);
    await page.getByText('Select Fare',{exact:true}).waitFor();
    await page.waitForFunction(()=>{const el=document.querySelector('.m-middle-flightInfo');return !!el&&(el as HTMLElement).innerText.length>10;},undefined,{timeout:timeoutMs});
    let text=await page.locator('.ift-drawer[aria-hidden="false"]').innerText();
    if(!/^\s*[A-Z0-9]{2}\d{1,4}[A-Z]?\s*$/m.test(text)) {
      await page.locator('.m-middle-flightInfo').click();
      await page.waitForFunction(()=>/^\s*[A-Z0-9]{2}\d{1,4}[A-Z]?\s*$/m.test((document.querySelector('.m-middle-flightInfo') as HTMLElement|null)?.innerText??''),undefined,{timeout:10000});
    }
    text=await stableFareText(page,signal,timeoutMs,network,quietMs);assertNoAccessBlock(text);network.check();
    const evidence={rawTextPath:join(dir,`${candidate.id}.txt`),screenshotPath:join(dir,`${candidate.id}.png`)};
    await writeFile(evidence.rawTextPath,text);await page.screenshot({path:evidence.screenshotPath});
    const cards=await page.locator('.ift-drawer[aria-hidden="false"] .J_brandedFarePolicy').evaluateAll(nodes=>nodes.filter(node=>{
      const el=node as HTMLElement;
      return !!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)&&Array.from(el.querySelectorAll('button')).some(button=>button.innerText.trim()==='Select'&&!button.disabled);
    }).map(node=>(node as HTMLElement).innerText));
    const fare=quotedFare(text,query,checked,cards,allowReprice);
    const detailText=text.slice(0,text.indexOf('Select Fare'))+'Select Fare\n'+fare.text;
    const combined=checked.journeys?parseRoundTripDetails(detailText,query,checked.journeys,evidence):null;
    const details=combined?.details??parseDetails(detailText,query,evidence);
    if(checked.journeys)checked.journeys.forEach((journey,index)=>validateDetails(journey,combined!.journeys[index]));
    else validateDetails(checked,details);
    const {amount,total}=fare;
    if(amount!==checked.price.amount) {
      if(!allowReprice)throw new FlightError('PRICE_CHANGED','Fare drawer price differs from the selected quote. Search again.');
      warnings.push(`Round-trip ${checked.id} repriced from ${checked.price.amount} to ${amount} ${query.currency} in the fare drawer. No cheapest-price guarantee.`);
      checked.price={amount,currency:query.currency,basis:'per_adult',checkoutVerified:false};
    }
    if(total!==undefined)checked.price.totalAmount=total;
    if(!allowReprice)assertSamePrice(candidate,checked);
    checked.details=details;checked.detailsState='ready';
    if(combined)checked.journeys!.forEach((journey,index)=>{journey.details=combined.journeys[index];});
    signal.throwIfAborted();return checked;
  } finally {
    if(!signal.aborted&&await page.getByText('Select Fare',{exact:true}).isVisible().catch(()=>false))await closeDetails(page);
  }
}
