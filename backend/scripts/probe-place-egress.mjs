// One explicitly authorized production-provider transport probe.
// Preserves the linked ledger; proxy modes are explicit and TLS stays enabled.
import fs from 'node:fs'
import path from 'node:path'
import {NominatimProvider} from '../dist/places/nominatim.js'
import {placeFailureDetail} from '../dist/places/diagnostics.js'
const directory=path.resolve(process.env.PLACES_PROBE_LEDGER_DIRECTORY||'backend/.demo/places-map-20260922'),file=path.join(directory,'ledger.json'),lock=path.join(directory,'ledger.lock')
const envProxy=process.argv.includes('--env-proxy')
const requestProxy=process.argv.includes('--request-proxy')
if(requestProxy&&(!process.env.PLACES_PROXY_URL||envProxy||process.execArgv.includes('--use-env-proxy')||process.env.NODE_USE_ENV_PROXY==='1'))throw Error('Use PLACES_PROXY_URL only for request-scoped probe')
if(envProxy&&(!process.execArgv.includes('--use-env-proxy')||!process.env.HTTPS_PROXY))throw Error('Explicit --use-env-proxy and HTTPS_PROXY required')
if(!process.argv.includes('--execute')){console.log('Pass --execute for one request under the existing ledger authorization');process.exit()}
const fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid))
try {
 const ledger=JSON.parse(fs.readFileSync(file,'utf8'))
 if(ledger.version!==1||!(ledger.limit===24||(ledger.limit===null&&ledger.unlimitedPlaceCalls===true))||!Array.isArray(ledger.calls)||(ledger.limit!==null&&ledger.calls.length>=ledger.limit))throw Error('Invalid or exhausted original ledger')
 const call={number:ledger.calls.length+1,startedAt:new Date().toISOString(),status:'reserved',costUsd:0,transport:requestProxy?'production-request-scoped-proxy':envProxy?'node-explicit-env-proxy-fetch':'production-default-fetch',query:'Meiji Jingu Shrine, Tokyo'}
 ledger.calls.push(call);const save=()=>fs.writeFileSync(file,JSON.stringify(ledger,null,2));save()
 const started=Date.now()
 const provider=new NominatimProvider({baseUrl:'https://nominatim.openstreetmap.org/',userAgent:'FlightOR-place-validation/1.0 (bounded user-authorized research)',...(requestProxy?{proxyUrl:process.env.PLACES_PROXY_URL}:{})})
 try {const result=await provider.search({activityId:'egress-probe',name:'Meiji Jingu Shrine',aliases:[],city:'Tokyo',countryCode:'JP',sourceUrls:[]},AbortSignal.timeout(10000));call.status=result.status;call.placeId=result.place?.placeId}
 catch(error){call.status='failed';call.diagnostic=placeFailureDetail(error)}
 call.finishedAt=new Date().toISOString();call.durationMs=Date.now()-started;save()
 const report={scope:'Production NominatimProvider transport probe; not an API POST',requestScopedProxy:requestProxy,environmentProxyExplicit:envProxy,node:process.version,call,used:ledger.calls.length,limit:ledger.limit}
 fs.writeFileSync(path.join(directory,requestProxy?'production-egress-request-proxy.json':envProxy?'production-egress-env-proxy.json':'production-egress-followup.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{fs.closeSync(fd);fs.unlinkSync(lock)}
