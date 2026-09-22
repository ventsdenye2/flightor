// One explicitly authorized request using the production provider's default fetch.
// Retains the original cumulative ledger; never injects a proxy or disables TLS.
import fs from 'node:fs'
import path from 'node:path'
import {NominatimProvider} from '../dist/places/nominatim.js'
import {placeFailureDetail} from '../dist/places/diagnostics.js'
const directory=path.resolve('backend/.demo/places-map-20260922'),file=path.join(directory,'ledger.json'),lock=path.join(directory,'ledger.lock')
if(!process.argv.includes('--execute')){console.log('Pass --execute for one request under the existing 24-call authorization');process.exit()}
const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid))
try {
 const ledger=JSON.parse(fs.readFileSync(file,'utf8'))
 if(ledger.version!==1||ledger.limit!==24||!Array.isArray(ledger.calls)||ledger.calls.length>=24)throw Error('Invalid or exhausted original ledger')
 const call={number:ledger.calls.length+1,startedAt:new Date().toISOString(),status:'reserved',costUsd:0,transport:'production-default-fetch',query:'Meiji Jingu Shrine, Tokyo'}
 ledger.calls.push(call);const save=()=>fs.writeFileSync(file,JSON.stringify(ledger,null,2));save()
 const started=Date.now()
 const provider=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org/',userAgent:'FlightOR-place-validation/1.0 (bounded user-authorized research)'})
 try {const result=await provider.search({activityId:'egress-probe',name:'Meiji Jingu Shrine',aliases:[],city:'Tokyo',countryCode:'JP',sourceUrls:[]},AbortSignal.timeout(10000));call.status=result.status;call.placeId=result.place?.placeId}
 catch(error){call.status='failed';call.diagnostic=placeFailureDetail(error)}
 call.finishedAt=new Date().toISOString();call.durationMs=Date.now()-started;save()
 const report={scope:'Unmodified production NominatimProvider with default Node fetch, not harness proxy; no production API running implied',node:process.version,call,used:ledger.calls.length,limit:24}
 fs.writeFileSync(path.join(directory,'production-egress-followup.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{fs.closeSync(fd);fs.unlinkSync(lock)}
