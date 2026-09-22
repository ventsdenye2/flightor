// Diagnostic-only generated page in ignored dist. Never part of src/app.config.
// Uses persisted coordinates, not a POI query or synthetic basemap.
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript')
;(async()=>{
 const transport=JSON.parse(fs.readFileSync('backend/.demo/places-map-20260922/transport.json'))
 const enrichments=[]
 for(const entry of transport.entries){const r=await fetch(transport.baseUrl+'/v1/artifacts/'+entry.guides.zh.id+'/places',{headers:{authorization:'Bearer '+transport.token}});if(!r.ok)throw Error('Place read '+r.status);enrichments.push((await r.json()).enrichment)}
 const places=enrichments.flatMap(e=>Object.values(e.activities).map(a=>a.place?.place).filter(Boolean))
 const tokyo=places.find(p=>p.placeId==='osm:way:469908925')
 const beijing=enrichments.flatMap(e=>(e.flightPaths||[]).flat()).find(p=>p.name==='PEK'||p.name.includes('首都')||p.name.includes('Capital'))
 if(!tokyo||!beijing)throw Error('Saved Tokyo venue and Beijing airport required')
 const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/features/maps/coordinates.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports})
 const cases=[{id:'tokyo',name:tokyo.name,placeId:tokyo.placeId,kind:tokyo.kind,countryCode:'JP',...tokyo.coordinates},{...beijing,id:'beijing'}].map(p=>({...p,...mod.exports.displayPoint(p,'GCJ02')}))
 const dir='dist/pages/map-probe';fs.mkdirSync(dir,{recursive:true})
 fs.writeFileSync(path.join(dir,'index.json'),JSON.stringify({navigationBarTitleText:'Map diagnostic only',usingComponents:{'place-map':'/components/place-map/index'}}))
 fs.writeFileSync(path.join(dir,'index.wxml'),'<view style="padding:12px">{{label}}</view><map wx:if="{{stage===\'bare\'}}" id="bare" style="width:100%;height:420px" latitude="{{point.latitude}}" longitude="{{point.longitude}}" scale="13" show-location="{{false}}" bindupdated="event" binderror="event" bindauthsuccess="event" bindabilitysuccess="event" bindabilityfailed="event"/><place-map wx:else id="bridge" style="display:block;width:100%;height:420px" payload="{{payload}}" bindmapdiagnostic="event" bindmapfailure="event" bindselectplace="event"/><view>Saved coordinates. No navigation or current location. Basemap requires visual inspection.</view>')
 fs.writeFileSync(path.join(dir,'index.js'),`const cases=${JSON.stringify(cases)};Page({data:{stage:'bare',point:cases[0],payload:'',label:''},onLoad(q){const point=cases.find(p=>p.id===q.city)||cases[0];this.events=[];this.setData({point,stage:q.stage||'bare',label:point.id+' / '+(q.stage||'bare')+' / '+point.kind})},onReady(){if(this.data.stage==='bare')return;const c=this.selectComponent('#bridge'),p=this.data.point;c.setData({latitude:p.latitude,longitude:p.longitude,scale:13});if(this.data.stage==='bridge')return;this.setData({payload:JSON.stringify({markers:[{id:1,latitude:p.latitude,longitude:p.longitude,title:p.name,iconPath:'/assets/ui-experience/marker.png',width:32,height:40}],lines:[],bounds:this.data.stage==='fit'?[{latitude:p.latitude-.005,longitude:p.longitude-.005},{latitude:p.latitude+.005,longitude:p.longitude+.005}]:[]})})},event(e){this.events.push({type:e.type,detail:e.detail||null});if(this.events.length>50)this.events.shift()},getDiagnostics(){return this.events}})`)
 const app=JSON.parse(fs.readFileSync('dist/app.json'));if(!app.pages.includes('pages/map-probe/index'))app.pages.push('pages/map-probe/index');fs.writeFileSync('dist/app.json',JSON.stringify(app))
 if(process.argv.includes('--isolated')){
  const root='.tmp/native-map-probe';fs.mkdirSync(root,{recursive:true})
  fs.cpSync(dir,path.join(root,'pages/map-probe'),{recursive:true})
  fs.cpSync('src/components/place-map',path.join(root,'components/place-map'),{recursive:true})
  fs.mkdirSync(path.join(root,'assets/ui-experience'),{recursive:true});fs.copyFileSync('src/assets/ui-experience/marker.png',path.join(root,'assets/ui-experience/marker.png'))
  fs.writeFileSync(path.join(root,'app.json'),JSON.stringify({pages:['pages/map-probe/index'],window:{navigationBarTitleText:'Native map control',backgroundColor:'#ffffff'}}))
  fs.writeFileSync(path.join(root,'app.wxss'),'page{background:#fff;color:#172f56}')
  fs.writeFileSync(path.join(root,'app.js'),'globalThis.__FLIGHTOR_BUILD__='+JSON.stringify({sha:JSON.parse(fs.readFileSync('dist/build-info.json')).gitSha,...JSON.parse(fs.readFileSync('dist/build-info.json')),diagnosticOnly:true})+';App({})')
  const project=JSON.parse(fs.readFileSync('project.config.json'));fs.writeFileSync(path.join(root,'project.config.json'),JSON.stringify({appid:project.appid,libVersion:project.libVersion,projectname:'FlightOR native map control',compileType:'miniprogram',miniprogramRoot:'./',setting:{es6:true}}))
 }
 fs.mkdirSync('output/weapp/map-followup',{recursive:true});fs.writeFileSync('output/weapp/map-followup/probe-coordinates.json',JSON.stringify(cases,null,2));console.log('Generated diagnostic-only page using saved Tokyo venue and Beijing airport')
})().catch(e=>{console.error(e);process.exitCode=1})
