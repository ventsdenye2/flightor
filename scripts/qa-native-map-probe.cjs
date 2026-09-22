const fs=require('fs'),path=require('path'),automator=require('../.tmp/wechat-sdk/node_modules/miniprogram-automator')
const {diagnosticDetail}=require('../src/components/place-map/diagnostic-detail')
const out=path.resolve('output/weapp/map-followup'),report={scope:'Diagnostic page added only to current dist; saved coordinates; actual DevTools native basemap; no API fixture or POI queries; no physical device',cases:[],errors:[],recordedAt:new Date().toISOString()}
fs.mkdirSync(out,{recursive:true})
;(async()=>{
 const mini=await automator.connect({wsEndpoint:process.argv.includes('--isolated')?'ws://127.0.0.1:9433':'ws://127.0.0.1:9432'})
 const timer=setTimeout(()=>{mini.disconnect();process.exitCode=1},90000)
 try{
  mini.on('exception',e=>report.errors.push(diagnosticDetail(e)))
  mini.on('console',e=>{if(e.level==='error'||e.type==='error')report.errors.push(diagnosticDetail(e))})
  report.runtime=await mini.evaluate(()=>({build:globalThis.__FLIGHTOR_BUILD__??null,appId:wx.getAccountInfoSync().miniProgram.appId,SDKVersion:wx.getSystemInfoSync().SDKVersion,platform:wx.getSystemInfoSync().platform,version:wx.getSystemInfoSync().version}))
  const disk=JSON.parse(fs.readFileSync('dist/build-info.json'));if(report.runtime.build?.sourceFingerprint!==disk.sourceFingerprint)throw Error('Runtime build mismatch')
  for(const city of ['beijing','tokyo'])for(const stage of ['bare','bridge','markers','fit']){
   const url='/pages/map-probe/index?city='+city+'&stage='+stage
   await mini.evaluate(url=>{wx.reLaunch({url});return true},url)
   await new Promise(r=>setTimeout(r,6000))
   const snapshot=await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0],c=p.selectComponent('#bridge');return{route:p.route,data:p.data,events:p.getDiagnostics(),componentDiagnostics:c?.getDiagnostics?.()??null}})
   if(snapshot.route!=='pages/map-probe/index')throw Error('Diagnostic page not compiled')
   const entry={city,stage,...snapshot,basemap:'requires_visual_inspection'}
   report.cases.push(entry)
   await mini.screenshot({path:path.join(out,city+'-'+stage+'.png')});console.log(city,stage,JSON.stringify(entry.events))
  }
 }finally{clearTimeout(timer);mini.disconnect()}
})().catch(e=>{report.failure=String(e);process.exitCode=1;console.error(e)}).finally(()=>fs.writeFileSync(path.join(out,'native-probe.json'),JSON.stringify(report,null,2)))
