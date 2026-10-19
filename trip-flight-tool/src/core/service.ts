import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { searchInputSchema,detailsInputSchema,type SearchInput,type SearchResult,type Candidate,type ToolFailure,type Location } from './types.js';
import { resolveLocation,validateDate } from './locations.js';
import { FlightError,failure } from './errors.js';
import { ResultStore } from './store.js';
import { configFromEnv,type ToolConfig } from '../browser/config.js';
import { SessionStore } from '../browser/session.js';
import { submitSearch,waitForResults,sortAndStabilize,readCards,closeDetails,assertNoAccessBlock,openCandidate,observeSearchNetwork,completeSearchWithSamePageRetry,verifyUrl,type SearchNetwork } from '../providers/trip/browser.js';
import { parseCard,parseDetails,parseAmount,parseResultCount } from '../providers/trip/parser.js';

export class FlightTool {
  private browser?: Browser;
  private userAgent?:string;
  private loginContext?:BrowserContext;
  private busy=false;
  readonly config:ToolConfig;
  readonly store:ResultStore;
  readonly session:SessionStore;
  constructor(config:Partial<ToolConfig>={}) { this.config=configFromEnv(config);this.store=new ResultStore(this.config.artifactDir);this.session=new SessionStore(this.config.sessionPath); }
  async close() { const browser=this.browser;this.browser=undefined;this.loginContext=undefined;await browser?.close(); }
  async openLogin():Promise<void> {
    if(this.busy)throw new FlightError('BUSY','Wait for the current query before opening login');
    await this.close();
    try {
      const storageState=await this.session.load();
      this.browser=await chromium.launch({channel:'chrome',headless:false,timeout:this.config.stepTimeoutMs});
      this.loginContext=await this.browser.newContext({locale:'en-US',viewport:{width:1440,height:1100},timezoneId:'Asia/Shanghai',storageState});
      const page=await this.loginContext.newPage();
      this.userAgent=await page.evaluate(()=>navigator.userAgent);
      await page.goto('https://www.trip.com/flights/?locale=en-XX&curr=USD',{waitUntil:'domcontentloaded',timeout:this.config.stepTimeoutMs});
    }catch(error){await this.close();throw error;}
  }
  async saveLoginSession():Promise<{status:'saved';sessionPath:string}> {
    if(!this.loginContext)throw new FlightError('LOGIN_NOT_OPEN','Open the login browser first');
    await this.session.save(this.loginContext);
    return {status:'saved',sessionPath:this.config.sessionPath};
  }
  async getFlightDetails(input:unknown) {
    const parsed=detailsInputSchema.safeParse(input);
    if(!parsed.success) return failure(new FlightError('INVALID_ARGUMENTS',parsed.error.message));
    try {return await this.store.details(parsed.data);} catch(error) {return failure(error);}
  }
  async searchFlights(input:SearchInput|unknown,options:{signal?:AbortSignal}={}):Promise<SearchResult|ToolFailure> {
    const parsed=searchInputSchema.safeParse(input);
    if(!parsed.success) return failure(new FlightError('INVALID_ARGUMENTS',parsed.error.message));
    const query=parsed.data;
    let resolved:{origin:Location;destination:Location};
    try {
      resolved={origin:resolveLocation(query.origin),destination:resolveLocation(query.destination)};
      if(resolved.origin.airports.some(code=>resolved.destination.airports.includes(code))) throw new FlightError('INVALID_ARGUMENTS','Origin and destination must be distinct');
      if(query.adults!==1) throw new FlightError('INVALID_ARGUMENTS','Version 0.1 supports one adult; multi-passenger pricing is not yet implemented');
      validateDate(query,resolved.origin.timeZone);
    } catch(error) {return failure(error);}
    if(this.busy) return failure(new FlightError('BUSY','This browser worker is already running a search; retry after it completes',true));
    this.busy=true;
    const deadline=AbortSignal.timeout(this.config.timeoutMs);
    const signal=options.signal?AbortSignal.any([deadline,options.signal]):deadline;
    const searchId=randomUUID(),dir=this.store.directory(searchId);
    let attempts=0;
    try {
      signal.throwIfAborted();await mkdir(dir,{recursive:true});
      while(attempts<this.config.maxAttempts) {
        attempts++;
        let page:Page|undefined;
        let context:BrowserContext|undefined;
        let cancel:(()=>void)|undefined;
        let network:SearchNetwork|undefined;
        let persistSession=false;
        try {
          if(!this.browser?.isConnected()) {
            try {
              this.browser=await chromium.launch({channel:'chrome',headless:true,timeout:Math.min(this.config.stepTimeoutMs,30000)});
              const probe=await this.browser.newPage();
              this.userAgent=(await probe.evaluate(()=>navigator.userAgent)).replace('HeadlessChrome/','Chrome/');
              await probe.close();
            }
            catch(error) {throw new FlightError('BROWSER_UNAVAILABLE',`Cannot launch headless Chrome. Install Google Chrome. ${error instanceof Error?error.message:''}`);}
          }
          signal.throwIfAborted();
          const storageState=this.loginContext?undefined:await this.session.load();
          persistSession=!!this.loginContext||!!storageState;
          context=this.loginContext??await this.browser.newContext({locale:'en-US',viewport:{width:1440,height:1100},timezoneId:resolved.origin.timeZone,userAgent:this.userAgent,storageState});
          cancel=()=>{void context?.close().catch(()=>{});};
          signal.addEventListener('abort',cancel,{once:true});
          if(signal.aborted) {cancel();signal.throwIfAborted();}
          page=this.loginContext?.pages().find(p=>new URL(p.url()).hostname.endsWith('trip.com'))??await context.newPage();page.setDefaultTimeout(this.config.stepTimeoutMs);page.setDefaultNavigationTimeout(this.config.stepTimeoutMs);
          network=observeSearchNetwork(page);
          await submitSearch(page,query,resolved,signal);
          const initialAttempt=attempts;
          const samePageRetried=await completeSearchWithSamePageRetry(page,network,signal,this.config.stepTimeoutMs,{
            allowRetry:attempts<this.config.maxAttempts,
            onRetry:async()=>{
              const screenshotPath=join(dir,`attempt-${attempts}-error.png`),rawTextPath=join(dir,`attempt-${attempts}-error.txt`);
              await page!.screenshot({path:screenshotPath});await writeFile(rawTextPath,await page!.locator('body').innerText());
              const firstFailure=failure(network!.error!,attempts);firstFailure.evidence={screenshotPath,rawTextPath};
              await writeFile(join(dir,`attempt-${attempts}-error.json`),JSON.stringify(firstFailure,null,2));
              await writeFile(join(dir,`attempt-${attempts}-network.json`),JSON.stringify(network!.responses,null,2));
              attempts++;
              await writeFile(join(dir,'same-page-retry.json'),JSON.stringify({trigger:'FlightListSearchSSE HTTP 430',action:'click Search on the same page',delayMs:2000,initialAttempt,retryAttempt:attempts,observedAt:new Date().toISOString()},null,2));
            },
          });
          verifyUrl(page.url(),query,resolved);
          const apiCount=network.responses.filter(r=>r.path.includes('FlightListSearchSSE')).at(-1)?.recordCount;
          const state=await waitForResults(page,signal,this.config.stepTimeoutMs,network.check,apiCount);
          const stable=state==='results'?await sortAndStabilize(page,signal,this.config.stepTimeoutMs,network.check):true;
          network.check();
          const text=await page.locator('body').innerText();
          const data=state==='results'?await readCards(page):[];
          const parsedCards=data.map(card=>parseCard(card,query));
          if(state==='results'&&!parsedCards.length) throw new FlightError('RESULTS_CHANGED','Results disappeared before extraction; no fare was published');
          for(const c of parsedCards) {
            if(!resolved.origin.airports.includes(c.departureAirport)||!resolved.destination.airports.includes(c.arrivalAirport)||!c.departureLocal.startsWith(query.departureDate)) throw new FlightError('QUERY_MISMATCH','A returned flight does not match the requested airports/date');
          }
          const sorted=parsedCards.every((c,i)=>i===0||c.price.amount>=parsedCards[i-1].price.amount);
          if(!sorted) throw new FlightError('SORT_NOT_CONFIRMED','Displayed candidates are not in ascending price order; refusing to claim a cheapest fare');
          const candidates=parsedCards.slice(0,query.maxResults);
          if(new Set(candidates.map(c=>c.id)).size!==candidates.length) throw new FlightError('AMBIGUOUS_CANDIDATES','Some displayed candidates cannot be distinguished safely; no details were attributed');
          const evidence={screenshotPath:join(dir,'search.png'),rawTextPath:join(dir,'search.txt'),resultPath:join(dir,'result.json')};
          await page.screenshot({path:evidence.screenshotPath});await writeFile(evidence.rawTextPath,text);
          const observedAt=new Date().toISOString();
          const providerResultCount=parseResultCount(text);
          const warnings:string[]=['Search quote only; final price and availability require checkout revalidation.'];
          if(samePageRetried)warnings.push('Initial HTTP 430 recovered after one Search click on the same page and browser session.');
          if(!stable) warnings.push('Result list did not stabilize before its step deadline.');
          if(state==='results' && providerResultCount===null) warnings.push('Provider result count was unavailable; completeness is unknown.');
          const sourceUrl=page.url();
          for(let i=0;i<candidates.length;i++) {
            signal.throwIfAborted();
            network.check();
            try {
              // Identity is checked again immediately before opening this position.
              const current=(await readCards(page))[i];
              if(!current||parseCard(current,query).id!==candidates[i].id) throw new FlightError('RESULTS_CHANGED','Candidate order changed while fetching details; rerun search',true);
              await openCandidate(page,i);
              await page.getByText('Select Fare',{exact:true}).waitFor();
              await page.waitForFunction(()=>{const el=document.querySelector('.m-middle-flightInfo');return !!el&&(el as HTMLElement).innerText.length>10;},undefined,{timeout:this.config.stepTimeoutMs});
              let detailText=await page.locator('.ift-drawer[aria-hidden="false"]').innerText();
              if(!/^\s*[A-Z0-9]{2}\d{1,4}[A-Z]?\s*$/m.test(detailText)) {
                await page.locator('.m-middle-flightInfo').click();
                await page.waitForFunction(()=>/^\s*[A-Z0-9]{2}\d{1,4}[A-Z]?\s*$/m.test((document.querySelector('.m-middle-flightInfo') as HTMLElement|null)?.innerText??''),undefined,{timeout:10000});
                detailText=await page.locator('.ift-drawer[aria-hidden="false"]').innerText();
              }
              assertNoAccessBlock(detailText);
              network.check();
              const detailEvidence={rawTextPath:join(dir,`${candidates[i].id}.txt`),screenshotPath:join(dir,`${candidates[i].id}.png`)};
              await writeFile(detailEvidence.rawTextPath,detailText);await page.screenshot({path:detailEvidence.screenshotPath});
              const detail=parseDetails(detailText,query,detailEvidence);
              this.validateDetails(candidates[i],detail);
              // The first fare card is the basic fare, excluding optional TripFlex upsells.
              const fareAmount=parseAmount(detailText.slice(detailText.indexOf('Select Fare')),query.currency);
              if(fareAmount!==candidates[i].price.amount) throw new FlightError('PRICE_CHANGED','Fare details price differs from the sorted search quote; rerun the search',true);
              candidates[i].details=detail;
            } catch(error) {
              if(signal.aborted) throw signal.reason;
              network.check();
              warnings.push(`Details for ${candidates[i].id}: ${error instanceof Error?error.message:String(error)}`);
            } finally {
              if(!signal.aborted && await page.getByText('Select Fare',{exact:true}).isVisible().catch(()=>false)) await closeDetails(page);
            }
          }
          const complete=stable&&(state==='no_results'||(providerResultCount!==null&&candidates.every(c=>c.details!==null)));
          network.check();
          const result:SearchResult={schemaVersion:1,searchId,status:state==='no_results'?'no_results':complete?'complete':'partial',source:'Trip.com',quoteType:'search_quote',query,resolved,observedAt,sourceUrl,sort:'cheapest',providerResultCount,
            coverage:state==='results'&&stable&&providerResultCount!==null?'provider_sorted_results':'unknown',lowestPriceVerified:state==='results'&&candidates.length>0&&stable&&sorted&&providerResultCount!==null,attempts,candidates,warnings,evidence};
          await this.store.save(result);return result;
        } catch(error) {
          if(signal.aborted) throw signal.reason;
          let normalized:FlightError;
          if(error instanceof FlightError) normalized=error;
          else if(error instanceof Error && /net::ERR_(?:TIMED_OUT|CONNECTION_RESET|NETWORK_CHANGED|CONNECTION_CLOSED)/.test(error.message)) normalized=new FlightError('NETWORK_ERROR',error.message,true);
          else normalized=new FlightError('PAGE_CHANGED',error instanceof Error?error.message:String(error));
          if(network?.error)normalized=network.error;
          if(page && !page.isClosed()) {
            const snapshot=await page.locator('body').innerText().catch(()=>'');
            try {assertNoAccessBlock(snapshot);} catch(block) {if(block instanceof FlightError) normalized=block;}
            const screenshotPath=join(dir,`attempt-${attempts}-error.png`),rawTextPath=join(dir,`attempt-${attempts}-error.txt`);
            await page.screenshot({path:screenshotPath}).catch(()=>{});await writeFile(rawTextPath,snapshot);
            normalized.evidence={screenshotPath,rawTextPath};
          }
          await writeFile(join(dir,`attempt-${attempts}-error.json`),JSON.stringify(failure(normalized,attempts),null,2));
          if(!normalized.retryable||attempts>=this.config.maxAttempts) throw normalized;
        } finally {
          network?.dispose();
          if(network)await writeFile(join(dir,`attempt-${attempts}-network.json`),JSON.stringify(network.responses,null,2));
          if(persistSession&&context)await this.session.save(context).catch(()=>{process.stderr.write('Trip.com session refresh could not be saved.\n');});
          if(this.loginContext===context)this.loginContext=undefined;
          if(cancel)signal.removeEventListener('abort',cancel);await context?.close();
        }
        await delay(1000,undefined,{signal});
      }
      throw new FlightError('INTERNAL_ERROR','Search attempts exhausted');
    } catch(error) {return failure(error,attempts);} finally {this.busy=false;}
  }
  private validateDetails(candidate:Candidate,detail:NonNullable<Candidate['details']>) {
    const first=detail.segments[0],last=detail.segments.at(-1)!;
    if(first.origin!==candidate.departureAirport||last.destination!==candidate.arrivalAirport||first.departureLocal!==candidate.departureLocal||last.arrivalLocal!==candidate.arrivalLocal) throw new FlightError('DETAILS_MISMATCH','Detailed itinerary differs from the selected candidate');
    if(candidate.stopCount!==null&&detail.segments.length!==candidate.stopCount+1) throw new FlightError('DETAILS_MISMATCH','Segment count differs from displayed stop count');
    if(detail.connections.length!==detail.segments.length-1) throw new FlightError('DETAILS_MISMATCH','Connection conditions are incomplete');
  }
}
