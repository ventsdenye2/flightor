// Read-only saved point; copy a clean compiled app to an ignored diagnostic project.
// No modifications to the production map component and no POI calls.
const fs=require('fs'),path=require('path'),crypto=require('crypto')
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist'),target=path.join(root,'.tmp/fixed-map-observation')
const build=JSON.parse(fs.readFileSync(path.join(dist,'build-info.json')))
if(!build.gitSha.startsWith('52cb1c3')||build.dirty)throw Error('Clean 52cb1c3 build required')
const prior=JSON.parse(fs.readFileSync(path.join(root,'docs/design/budget-travel-agent/map-followup-evidence/native-probe.json')))
const point=prior.cases.find(c=>c.city==='tokyo').data.point
if(point.placeId!=='osm:way:469908925'||point.converted)throw Error('Saved unshifted Tokyo identity required')
fs.mkdirSync(target,{recursive:true});fs.cpSync(dist,target,{recursive:true})
const dir=path.join(target,'pages/map-observe');fs.mkdirSync(dir,{recursive:true})
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(dist,file))).digest('hex')
const manifest={build,point,scale:13,files:Object.fromEntries(['app.js','pages/route/index.js','components/place-map/index.js','components/place-map/index.wxml'].map(f=>[f,sha(f)])),scope:'Copied production build; diagnostic host only; unchanged compiled production native bridge'}
fs.writeFileSync(path.join(target,'observation-manifest.json'),JSON.stringify(manifest,null,2))
fs.writeFileSync(path.join(dir,'index.json'),JSON.stringify({navigationBarTitleText:'Tokyo fixed observation',usingComponents:{'place-map':'/components/place-map/index'}}))
fs.writeFileSync(path.join(dir,'index.wxss'),'page{background:#fff;color:#172f56}.map-host{display:block;height:360px;width:100%}')
fs.writeFileSync(path.join(dir,'index.wxml'),'<view>Tokyo · Meiji Jingu · scale 13 · saved POI</view><place-map id="fixed-map" class="map-host" payload="{{payload}}" bindmapdiagnostic="observe" bindmapfailure="observe"/><view>Same foreground window. No navigation or rebuild during observation.</view>')
fs.writeFileSync(path.join(dir,'index.js'),`const point=${JSON.stringify(point)};Page({data:{payload:''},onLoad(){this.events=[];globalThis.__fixedMapStartedAt=Date.now();this.setData({payload:JSON.stringify({markers:[{id:1,latitude:point.latitude,longitude:point.longitude,title:point.name,iconPath:'/assets/ui-experience/marker.png',width:32,height:40}],lines:[],bounds:[]})})},observe(e){this.events.push({at:Date.now(),type:e.type,detail:e.detail});if(this.events.length>100)this.events.shift()},readObservation(){const c=this.selectComponent('#fixed-map');return{startedAt:globalThis.__fixedMapStartedAt,at:Date.now(),events:this.events,component:c?{data:c.data,diagnostics:c.getDiagnostics(),fitSource:c.fitBounds.toString(),updatedSource:c.mapReady.toString()}:null}}})`)
const app=JSON.parse(fs.readFileSync(path.join(target,'app.json')));app.pages=['pages/map-observe/index',...app.pages];fs.writeFileSync(path.join(target,'app.json'),JSON.stringify(app))
const config=JSON.parse(fs.readFileSync(path.join(root,'project.config.json')));fs.writeFileSync(path.join(target,'project.config.json'),JSON.stringify({appid:config.appid,libVersion:config.libVersion,projectname:'FlightOR Tokyo 52cb1c3 fixed',compileType:'miniprogram',miniprogramRoot:'./',setting:{es6:true}}))
console.log(JSON.stringify({project:target,manifest}))
