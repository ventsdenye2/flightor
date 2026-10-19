// Diagnostic experiment only: one fresh, logged-out Chrome context, no stealth,
// cookie imports, request signatures, proxy rotation or CAPTCHA automation.
import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
import { searchInputSchema } from '../dist/core/types.js';
import { resolveLocation } from '../dist/core/locations.js';
import { submitSearch,waitForResults,sortAndStabilize,readCards,openCandidate } from '../dist/providers/trip/browser.js';
import { parseCard,parseDetails } from '../dist/providers/trip/parser.js';
const directory=`artifacts/headless-investigation-${process.env.TRIP_FLIGHT_TEST_CURRENCY??'USD'}`;await mkdir(directory,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const probe=await browser.newPage();const defaultUserAgent=await probe.evaluate(()=>navigator.userAgent);await probe.close();
const userAgent=defaultUserAgent.replace('HeadlessChrome/','Chrome/');
const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1100},timezoneId:'Asia/Shanghai',userAgent});
const page=await context.newPage();page.setDefaultTimeout(25000);page.setDefaultNavigationTimeout(25000);
const query=searchInputSchema.parse({origin:'BJS',destination:'LIS',departureDate:'2026-10-28',currency:process.env.TRIP_FLIGHT_TEST_CURRENCY??'USD',maxResults:1});
const report={startedAt:new Date().toISOString(),headless:true,chromeVersion:browser.version(),defaultUserAgent,userAgent,changedSettings:['userAgent: HeadlessChrome -> Chrome'],query};
const network=[];const pending=[];
page.on('response',response=>{
  if(!['xhr','fetch'].includes(response.request().resourceType()))return;
  pending.push((async()=>{
    const u=new URL(response.url());const item={url:u.origin+u.pathname,status:response.status()};
    if((response.headers()['content-type']??'').includes('json')) {
      try {
        const data=await response.json();item.shape=[];
        const visit=(value,path,depth)=>{
          if(depth>3||value===null)return;
          if(Array.isArray(value)){item.shape.push({path,length:value.length});return;}
          if(typeof value==='object')for(const [key,v] of Object.entries(value)) {
            if(/token|secret|cookie|sign|key/i.test(key))continue;
            if(/^(code|status|message|msg|success|errorCode)$/i.test(key)&&['string','number','boolean'].includes(typeof v))item.shape.push({path:path+'.'+key,value:String(v).slice(0,200)});
            else visit(v,path+'.'+key,depth+1);
          }
        };visit(data,'$',0);
      }catch{}
    }
    if(u.pathname.includes('FlightListSearchSSE')) {
      try {
        const raw=await response.text();item.streamLength=raw.length;item.streamEvents=[];
        for(const line of raw.split('\n')) {
          const candidate=line.replace(/^data:\s*/,'').trim();if(!candidate.startsWith('{'))continue;
          try {
            const data=JSON.parse(candidate);const shape=[];
            const visit=(v,path,depth)=>{
              if(depth>5||v===null)return;
              if(Array.isArray(v)){shape.push({path,length:v.length});return;}
              if(typeof v==='object')for(const [k,value]of Object.entries(v)) {
                if(/token|cookie|sign|secret|key/i.test(k))continue;
                if(['string','number','boolean'].includes(typeof value)&&/code|status|error|message|finish|complete|count|success/i.test(k))shape.push({path:path+'.'+k,value:String(value).slice(0,250)});
                else visit(value,path+'.'+k,depth+1);
              }
            };visit(data,'$',0);item.streamEvents.push(shape);
          }catch{}
        }
      }catch(error){item.streamError=error.message;}
    }
    network.push(item);
  })());
});
try {
  const signal=AbortSignal.timeout(120000);
  await submitSearch(page,query,{origin:resolveLocation('BJS'),destination:resolveLocation('LIS')},signal);
  const state=await waitForResults(page,signal,25000);if(state==='no_results'){report.status='no_results';throw new Error('Page explicitly displayed no results; compare provider response diagnostics');}await sortAndStabilize(page,signal,25000);
  const candidates=(await readCards(page)).map(card=>parseCard(card,query));report.candidates=candidates.slice(0,3);
  await openCandidate(page,0);
  await page.getByText('Select Fare',{exact:true}).waitFor();
  await page.waitForFunction(()=>{const e=document.querySelector('.m-middle-flightInfo');return !!e&&e.innerText.length>10;},undefined,{timeout:25000});
  const text=await page.locator('.ift-drawer[aria-hidden="false"]').innerText();
  const evidence={rawTextPath:`${directory}/details.txt`,screenshotPath:`${directory}/details.png`};
  await writeFile(evidence.rawTextPath,text);await page.screenshot({path:evidence.screenshotPath});
  report.details=parseDetails(text,query,evidence);report.status='complete';
} catch(error) {report.status??='failed';report.error={name:error.name,code:error.code,message:error.message};}
finally {
  report.finishedAt=new Date().toISOString();report.url=page.url();
  await writeFile(`${directory}/page.txt`,await page.locator('body').innerText().catch(()=>''));
  await page.screenshot({path:`${directory}/page.png`}).catch(()=>{});
  await Promise.allSettled(pending);report.network=network.filter(n=>/flight|flights|search|list/i.test(n.url));
  await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,error:report.error,lowest:report.candidates?.[0]?.price,stream:report.network.filter(n=>n.url.includes('FlightListSearchSSE'))},null,2));await browser.close();
}
