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
    const combined=checked.journeys?parseRoundTripDetails(text,query,checked.journeys,evidence):null;
    const details=combined?.details??parseDetails(text,query,evidence);
    if(checked.journeys)checked.journeys.forEach((journey,index)=>validateDetails(journey,combined!.journeys[index]));
    else validateDetails(checked,details);
    const fareText=text.slice(text.indexOf('Select Fare'));
    const amount=parseAmount(fareText,query.currency);
    const totalLine=fareText.split('\n').find(line=>/^Total\s/i.test(line.trim()));
    const total=totalLine?parseAmount(totalLine,query.currency):undefined;
    if(query.adults>1&&total===undefined)throw new FlightError('PAGE_CHANGED','Fare drawer is missing the passenger total');
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
