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
import { submitSearch,tryDirectSearch,waitForResults,sortAndStabilize,readCards,assertNoAccessBlock,openCandidate,observeSearchNetwork,completeSearchWithSamePageRetry,verifyUrl,publicSearchUrl,type SearchNetwork } from '../providers/trip/browser.js';
import { parseCard,combineRoundTrip,parseResultCount,bindCandidateIdentities } from '../providers/trip/parser.js';

import {assertSamePrice,readCandidateDetails} from '../providers/trip/details.js';
interface ActiveSearch { result:SearchResult;context:BrowserContext;page:Page;network:SearchNetwork;readCandidates:()=>Promise<Candidate[]>;persistSession:boolean }

export class FlightTool {
  private activeSearch?:ActiveSearch;
  private browser?: Browser;
  private userAgent?:string;
  private loginContext?:BrowserContext;
  private busy=false;
  readonly config:ToolConfig;
  readonly store:ResultStore;
  readonly session:SessionStore;
  constructor(config:Partial<ToolConfig>={}) { this.config=configFromEnv(config);this.store=new ResultStore(this.config.artifactDir);this.session=new SessionStore(this.config.sessionPath); }
  async close() {
    const active=this.activeSearch;this.activeSearch=undefined;active?.network.dispose();
    if(active?.persistSession&&!active.page.isClosed())await this.session.save(active.context).catch(()=>{});
    const browser=this.browser;this.browser=undefined;this.loginContext=undefined;await browser?.close();
  }
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
  async getFlightDetails(input:unknown,options:{signal?:AbortSignal;refresh?:boolean}={}) {
    const startedAt=Date.now();
    const parsed=detailsInputSchema.safeParse(input);
    if(!parsed.success) return failure(new FlightError('INVALID_ARGUMENTS',parsed.error.message));
    let ownsSlot=false;
    try {
      const saved=await this.store.load(parsed.data.searchId);
      const candidate=saved.candidates.find(c=>c.id===parsed.data.candidateId);
      if(!candidate)throw new FlightError('CANDIDATE_NOT_FOUND','Candidate does not belong to this search');
      if(candidate.detailsState==='deferred'||options.refresh) {
        const active=this.activeSearch;
        let checked:Candidate|undefined;
        let detailAccess='recovered_search';
        if(active?.result.searchId===saved.searchId&&!active.page.isClosed()&&Date.now()-Date.parse(active.result.observedAt)<300000) {
          if(this.busy)throw new FlightError('BUSY','This browser worker is already running a query',true);
          this.busy=true;ownsSlot=true;detailAccess='live_page';
          const deadline=AbortSignal.timeout(this.config.timeoutMs);
          const signal=options.signal?AbortSignal.any([deadline,options.signal]):deadline;
          const cancel=()=>{void active.context.close().catch(()=>{});};
          signal.addEventListener('abort',cancel,{once:true});
          try {
            signal.throwIfAborted();verifyUrl(active.page.url(),saved.query,saved.resolved);
            assertNoAccessBlock(await active.page.locator('body').innerText());
            if(!active.network.searchCompleted)await active.network.waitForSearch(signal,this.config.stepTimeoutMs);
            checked=await readCandidateDetails({...active,query:saved.query,candidate,dir:this.store.directory(saved.searchId),signal,timeoutMs:this.config.stepTimeoutMs,quietMs:this.config.fareQuietMs});
          } finally {
            signal.removeEventListener('abort',cancel);
            await writeFile(join(this.store.directory(saved.searchId),'details-network.json'),JSON.stringify(active.network.responses,null,2));
          }
        } else {
          if(candidate.pageBound)throw new FlightError('RESULTS_CHANGED','Similar flight options require the original result page. Search again before choosing.');
          const fresh=await this.searchFlights(saved.query,{signal:options.signal,detailCandidate:candidate});
          if('code' in fresh)return fresh;
          checked=fresh.candidates.find(c=>c.id===candidate.id);
        }
        if(!checked?.details)throw new FlightError('DETAILS_UNAVAILABLE','Selected flight details could not be validated. Search again.');
        assertSamePrice(candidate,checked);
        options.signal?.throwIfAborted();
        Object.assign(candidate,checked,{detailsState:'ready'});
        await this.store.save(saved);
        if(this.activeSearch?.result.searchId!==saved.searchId&&this.activeSearch)this.activeSearch.result=saved;
        return {...await this.store.details(parsed.data),detailAccess,detailElapsedMs:Date.now()-startedAt};
      }
      return await this.store.details(parsed.data);
    } catch(error) {return failure(error);} finally {if(ownsSlot)this.busy=false;}
  }
  async searchFlights(input:SearchInput|unknown,options:{signal?:AbortSignal;withDetails?:boolean;detailCandidate?:Candidate}={}):Promise<SearchResult|ToolFailure> {
    const parsed=searchInputSchema.safeParse(input);
    if(!parsed.success) return failure(new FlightError('INVALID_ARGUMENTS',parsed.error.message));
    const query=parsed.data;
    let resolved:{origin:Location;destination:Location};
    try {
      resolved={origin:resolveLocation(query.origin),destination:resolveLocation(query.destination)};
      if(resolved.origin.airports.some(code=>resolved.destination.airports.includes(code))) throw new FlightError('INVALID_ARGUMENTS','Origin and destination must be distinct');
      validateDate(query,resolved.origin.timeZone);
      if(query.tripType==='round_trip') {
        if(!query.returnDate) throw new FlightError('INVALID_ARGUMENTS','round_trip requires both departureDate and returnDate');
        validateDate({...query,departureDate:query.returnDate},resolved.destination.timeZone);
        if(query.returnDate<query.departureDate) throw new FlightError('INVALID_ARGUMENTS','returnDate must not precede departureDate');
      } else if(query.returnDate) throw new FlightError('INVALID_ARGUMENTS','returnDate is only valid for round_trip');
    } catch(error) {return failure(error);}
    if(this.busy) return failure(new FlightError('BUSY','This browser worker is already running a search; retry after it completes',true));
    this.busy=true;
    const deadline=AbortSignal.timeout(this.config.timeoutMs);
    const signal=options.signal?AbortSignal.any([deadline,options.signal]):deadline;
    const searchId=randomUUID(),dir=this.store.directory(searchId);
    let attempts=0;
    let previous=this.activeSearch;this.activeSearch=undefined;previous?.network.dispose();
    try {
      signal.throwIfAborted();await mkdir(dir,{recursive:true});
      if(previous&&(previous.page.isClosed()||previous.result.resolved.origin.timeZone!==resolved.origin.timeZone)) {
        if(previous.persistSession&&!previous.page.isClosed())await this.session.save(previous.context).catch(()=>{});
        await previous.context.close().catch(()=>{});previous=undefined;
      }
      while(attempts<this.config.maxAttempts) {
        attempts++;
        let page:Page|undefined;
        let context:BrowserContext|undefined;
        let cancel:(()=>void)|undefined;
        let cancelDone:Promise<void>|undefined;
        let network:SearchNetwork|undefined;
        let persistSession=false;
        let phase='browser_start';
        let searchEntry='form';
        let retained=false;
        const reusedContext=!!previous;
        const attemptStartedAt=Date.now();
        const timingsMs:Record<string,number>={};let phaseSince=attemptStartedAt;
        const mark=(next:string)=>{timingsMs[phase]=(timingsMs[phase]??0)+Date.now()-phaseSince;phase=next;phaseSince=Date.now();};
        try {
          cancel=()=>{
            if(cancelDone)return;
            if(context)cancelDone=context.close().catch(()=>{});
            else {const browser=this.browser;this.browser=undefined;cancelDone=browser?.close().catch(()=>{})??Promise.resolve();}
          };
          signal.addEventListener('abort',cancel,{once:true});
          if(signal.aborted){cancel();signal.throwIfAborted();}
          if(!this.browser?.isConnected()) {
            try {
              this.browser=await chromium.launch({channel:'chrome',headless:true,timeout:Math.min(this.config.stepTimeoutMs,30000)});
              const metadata=await this.browser.newBrowserCDPSession();
              try {this.userAgent=(await metadata.send('Browser.getVersion')).userAgent.replace('HeadlessChrome/','Chrome/');}
              finally {await metadata.detach();}
            }
            catch(error) {throw new FlightError('BROWSER_UNAVAILABLE',`Cannot launch headless Chrome. Install Google Chrome. ${error instanceof Error?error.message:''}`);}
          }
          signal.throwIfAborted();
          const storageState=this.loginContext||previous?undefined:await this.session.load();
          persistSession=previous?.persistSession||!!this.loginContext||!!storageState;
          context=previous?.context??this.loginContext??await this.browser.newContext({locale:'en-US',viewport:{width:1440,height:1100},timezoneId:resolved.origin.timeZone,userAgent:this.userAgent,storageState});
          if(signal.aborted) {cancel();signal.throwIfAborted();}
          page=previous?.page??this.loginContext?.pages().find(p=>new URL(p.url()).hostname.endsWith('trip.com'))??await context.newPage();page.setDefaultTimeout(this.config.stepTimeoutMs);page.setDefaultNavigationTimeout(this.config.stepTimeoutMs);
          previous=undefined;
          network=observeSearchNetwork(page,{resultsOnly:true,quietMs:this.config.networkQuietMs});
          mark('submit_search');
          const direct=this.config.directResults&&await tryDirectSearch(page,query,resolved,signal,network,this.config.stepTimeoutMs);
          searchEntry=direct?'direct':this.config.directResults?'form_fallback':'form';
          if(!direct)await submitSearch(page,query,resolved,signal);
          mark('search_response');
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
          mark('render_results');
          const apiCount=network.responses.filter(r=>r.searchRound===network!.round&&r.path.includes('FlightListSearch')).at(-1)?.recordCount;
          let state=await waitForResults(page,signal,this.config.stepTimeoutMs,network.check,apiCount);
          let stable=state==='results'?await sortAndStabilize(page,signal,this.config.stepTimeoutMs,network.check,this.config.listQuietMs,network,query.maxResults,apiCount):true;
          let outbound:Candidate|undefined;
          if(query.tripType==='round_trip'&&state==='results') {
            mark('return_options');
            const departures=(await readCards(page,query.maxResults)).map(card=>parseCard(card,query,'outbound_starting'));
            outbound=departures[0];
            if(!outbound||!departures.every((c,i)=>i===0||c.price.amount>=departures[i-1].price.amount)) throw new FlightError('SORT_NOT_CONFIRMED','Outbound round-trip starting fares are not sorted');
            if(!resolved.origin.airports.includes(outbound.departureAirport)||!resolved.destination.airports.includes(outbound.arrivalAirport)||!outbound.departureLocal.startsWith(query.departureDate)) throw new FlightError('QUERY_MISMATCH','Selected outbound does not match the request');
            await page.screenshot({path:join(dir,'outbound.png')});
            await writeFile(join(dir,'outbound.txt'),await page.locator('body').innerText());
            network.resetForResubmit('return');
            await openCandidate(page,0);
            await network.waitForSearch(signal,this.config.stepTimeoutMs);
            verifyUrl(page.url(),query,resolved);
            const returnCount=network.responses.filter(r=>r.searchRound===network!.round&&r.recordCount!==undefined).at(-1)?.recordCount;
            state=await waitForResults(page,signal,this.config.stepTimeoutMs,network.check,returnCount);
            stable=state==='results'?await sortAndStabilize(page,signal,this.config.stepTimeoutMs,network.check,this.config.listQuietMs,network,query.maxResults,returnCount??parseResultCount(await page.locator('body').innerText())??undefined):true;
          }
          network.check();
          const text=await page.locator('body').innerText();
          const ambiguousSummaries=new Set<string>();
          const readCandidates=async(limit?:number)=>{
            const cards=await readCards(page!,limit);
            return bindCandidateIdentities(cards.map(card=>outbound
              ?combineRoundTrip(outbound,parseCard(card,{...query,origin:query.destination,destination:query.origin,departureDate:query.returnDate!}))
              :parseCard(card,query)),cards,ambiguousSummaries);
          };
          const parsedCards=state==='results'?await readCandidates(options.withDetails||options.detailCandidate?undefined:query.maxResults):[];
          if(state==='results'&&!parsedCards.length) throw new FlightError('RESULTS_CHANGED','Results disappeared before extraction; no fare was published');
          for(const c of parsedCards) {
            if(!resolved.origin.airports.includes(c.departureAirport)||!resolved.destination.airports.includes(c.arrivalAirport)||!c.departureLocal.startsWith(query.departureDate)) throw new FlightError('QUERY_MISMATCH','A returned flight does not match the requested airports/date');
            if(query.tripType==='round_trip') {
              const back=c.journeys?.[1];
              if(!back||!resolved.destination.airports.includes(back.departureAirport)||!resolved.origin.airports.includes(back.arrivalAirport)||!back.departureLocal.startsWith(query.returnDate!)) throw new FlightError('QUERY_MISMATCH','Return journey does not match requested airports/date');
            }
          }
          const sorted=parsedCards.every((c,i)=>i===0||c.price.amount>=parsedCards[i-1].price.amount);
          if(!sorted) throw new FlightError('SORT_NOT_CONFIRMED','Displayed candidates are not in ascending price order; refusing to claim a cheapest fare');
          const candidates=options.detailCandidate?parsedCards.filter(c=>c.id===options.detailCandidate!.id):parsedCards.slice(0,query.maxResults);
          if(options.detailCandidate&&candidates.length!==1)throw new FlightError('RESULTS_CHANGED','Selected flight is no longer uniquely present. Search again.');
          if(options.detailCandidate&&(candidates[0].price.amount!==options.detailCandidate.price.amount||(candidates[0].price.totalAmount!==undefined&&options.detailCandidate.price.totalAmount!==undefined&&candidates[0].price.totalAmount!==options.detailCandidate.price.totalAmount)))throw new FlightError('PRICE_CHANGED','Selected flight list price changed. Search again.');
          if(new Set(candidates.map(c=>c.id)).size!==candidates.length) throw new FlightError('AMBIGUOUS_CANDIDATES','Some displayed candidates cannot be distinguished safely; no details were attributed');
          const evidence={screenshotPath:join(dir,'search.png'),rawTextPath:join(dir,'search.txt'),resultPath:join(dir,'result.json')};
          await page.screenshot({path:evidence.screenshotPath});await writeFile(evidence.rawTextPath,text);
          const observedAt=new Date().toISOString();
          mark('candidate_details');
          const providerResultCount=parseResultCount(text);
          const warnings:string[]=['Search quote only; final price and availability require checkout revalidation.'];
          if(candidates.some(c=>c.pageBound))warnings.push('Similar summaries are kept as separate original-page options. If that page expires or changes, search again; no itinerary or baggage is inferred from another option.');
          if(outbound) warnings.push('Native round-trip combinations for the first cheapest displayed outbound only; return-list prices are complete round-trip totals, not sums of separate one-way fares. Other outbound combinations were not exhaustively searched.');
          if(samePageRetried)warnings.push('Initial HTTP 430 recovered after one Search click on the same page and browser session.');
          if(!stable) warnings.push('Result list did not stabilize before its step deadline.');
          if(state==='results' && providerResultCount===null) warnings.push('Provider result count was unavailable; completeness is unknown.');
          const sourceUrl=publicSearchUrl(page.url());
          const withDetails=options.withDetails||!!options.detailCandidate;
          if(!withDetails){candidates.forEach(c=>{c.detailsState='deferred';});warnings.push('Only the published summaries were validated; no global lowest-price guarantee.');}
          for(let i=0;withDetails&&i<candidates.length;i++) {
            try {candidates[i]=await readCandidateDetails({page,network,query,candidate:candidates[i],readCandidates,dir,signal,timeoutMs:this.config.stepTimeoutMs,quietMs:this.config.fareQuietMs,allowReprice:!!outbound&&!options.detailCandidate,warnings});}
            catch(error) {
              signal.throwIfAborted();network.check();
              warnings.push(`Details for ${candidates[i].id}: ${error instanceof Error?error.message:String(error)}`);
            }
          }
          const complete=stable&&(state==='no_results'||(providerResultCount!==null&&(!withDetails||candidates.every(c=>c.details!==null))));
          network.check();
          if(outbound)candidates.sort((a,b)=>a.price.amount-b.price.amount);
          const result:SearchResult={schemaVersion:1,resultLevel:withDetails?'details':'summary',searchId,status:state==='no_results'?'no_results':complete?'complete':'partial',source:'Trip.com',quoteType:'search_quote',query,resolved,observedAt,sourceUrl,sort:'cheapest',providerResultCount,
            coverage:outbound?'selected_outbound_return_options':state==='results'&&stable&&providerResultCount!==null?'provider_sorted_results':'unknown',lowestPriceVerified:!!withDetails&&!outbound&&state==='results'&&candidates.length>0&&stable&&sorted&&providerResultCount!==null,attempts,candidates,warnings,evidence};
          mark('save_result');await this.store.save(result);mark('completed');
          if(this.config.reuseContext&&!page.isClosed()) {
            this.activeSearch={result,context,page,network,readCandidates:()=>readCandidates(),persistSession};retained=true;
          }
          return result;
        } catch(error) {
          if(signal.aborted) throw signal.reason;
          let normalized:FlightError;
          if(error instanceof FlightError) normalized=error;
          else if(error instanceof Error && error.name==='TimeoutError') normalized=new FlightError('TIMEOUT',error.message);
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
          mark(phase);
          const cleanupStarted=Date.now();
          if(!retained)network?.dispose();
          if(network)await writeFile(join(dir,`attempt-${attempts}-network.json`),JSON.stringify(network.responses,null,2));
          const currentUrl=page&&!page.isClosed()?page.url():undefined;
          if(!retained&&persistSession&&context&&!signal.aborted)await this.session.save(context).catch(()=>{process.stderr.write('Trip.com session refresh could not be saved.\n');});
          if(this.loginContext===context)this.loginContext=undefined;
          if(cancel)signal.removeEventListener('abort',cancel);if(!retained)await context?.close();
          await cancelDone;
          if(signal.aborted&&!context){const browser=this.browser;this.browser=undefined;await browser?.close();}
          timingsMs.cleanup=Date.now()-cleanupStarted;
          await writeFile(join(dir,`attempt-${attempts}-diagnostic.json`),JSON.stringify({phase,searchEntry,directFailure:network?.directFailure,reusedContext,retained,timingsMs,elapsedMs:Date.now()-attemptStartedAt,
            pagePath:currentUrl?new URL(currentUrl).pathname:null,
            publicSearchUrl:currentUrl&&new URL(currentUrl).hostname==='www.trip.com'?publicSearchUrl(currentUrl):null},null,2));
        }
        await delay(1000,undefined,{signal});
      }
      throw new FlightError('INTERNAL_ERROR','Search attempts exhausted');
    } catch(error) {return failure(error,attempts);} finally {if(previous)await previous.context.close().catch(()=>{});this.busy=false;}
  }
}
