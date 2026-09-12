// Read-only provider reconciliation. Conservatively include all usage on this
// API key today (possibly other tasks) and keep EVERY unknown reservation.
import {existsSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateLedger} from './budget.mjs';
import {withExclusiveLedgerLock} from './ledger-lock.mjs';
const here=dirname(fileURLToPath(import.meta.url)),runs=join(here,'.runs'),path=join(runs,'budget-ledger.json');
await withExclusiveLedgerLock(path, async () => {
const ledger=validateLedger(JSON.parse(readFileSync(path,'utf8')));
const today=new Date().toISOString().slice(0,10);
for(const dir of readdirSync(runs,{withFileTypes:true}).filter(d=>d.isDirectory())){
  const manifest=join(runs,dir.name,'manifest.json');
  if(existsSync(manifest)&&JSON.parse(readFileSync(manifest,'utf8')).startedAt.slice(0,10)!==today)throw new Error('CROSS_DAY_REQUIRES_MANUAL_RECONCILIATION');
}
const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`},signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error(`KEY_USAGE_HTTP_${response.status}`);
const {data}=await response.json();
if(typeof data?.usage_daily!=='number'||!Number.isFinite(data.usage_daily)||data.usage_daily<0)throw new Error('DAILY_USAGE_UNAVAILABLE');
const review={checkedAt:new Date().toISOString(),usageDaily:data.usage_daily,previousLedger:ledger,
  method:'Count all current UTC-day API-key charges conservatively; keep unknown reservations for possible delayed billing. Does not prove individual failed calls are free.'};
ledger.knownOpenRouterUsd=Math.max(ledger.knownOpenRouterUsd,data.usage_daily);
ledger.reviewedRejections=ledger.unknownCalls;
writeFileSync(join(runs,`billing-review-${Date.now()}.json`),JSON.stringify(review,null,2)+'\n');
writeFileSync(path,JSON.stringify(ledger,null,2)+'\n');
console.log(JSON.stringify({usageDaily:data.usage_daily,accountedUsd:ledger.knownOpenRouterUsd,heldUsd:ledger.reservedUnknownUsd,limitUsd:ledger.limitUsd}));
});
