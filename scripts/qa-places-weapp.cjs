const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const automator=require('../.tmp/wechat-sdk/node_modules/miniprogram-automator')
const transport=JSON.parse(fs.readFileSync('backend/.demo/places-map-20260922/transport.json','utf8'))
const followup=process.argv.includes('--followup')
const output=path.resolve('output/weapp/'+(followup?'map-followup-production':'places-map'));fs.mkdirSync(output,{recursive:true})
const report={scope:'Actual production WeChat DevTools native maps, SDK marker event + list tap; synthetic trip/text/login; fixture transport of fresh authenticated API reads of persisted live POI identities; not physical device or live WeChat HTTP acceptance',recordedAt:new Date().toISOString(),cases:[]}
let mini,original,storage,guest=false,originalLocale
const bounded=async(p,label)=>{let t;try{return await Promise.race([p,new Promise((_,reject)=>t=setTimeout(()=>reject(Error(label+' timeout')),25000))])}finally{clearTimeout(t)}}
const shot=name=>mini.screenshot({path:path.join(output,name+'.png')})
const text=async(p,selector)=>{const el=await p.$(selector);assert.ok(el,selector);return el.text()}
// Current DevTools can lose App.callWxMethod's navigation callback. Queue the
// normal wx navigation in the app and verify the actual current page afterwards.
async function navigate(url){const tab=/^\/pages\/(profile|plan|trips|explore)\/index$/.test(url);await mini.evaluate(({url,tab})=>{globalThis.__placesNavigation={url,state:'pending'};const options={url,success:()=>{globalThis.__placesNavigation.state='success'},fail:e=>{globalThis.__placesNavigation={url,state:'failed',error:e.errMsg}}};if(tab)wx.switchTab(options);else wx.redirectTo(options);return true},{url,tab});for(let i=0;i<15;i++){await new Promise(r=>setTimeout(r,1000));const page=await mini.currentPage();if(page.path===url.split('?')[0].slice(1)&&(await mini.evaluate(()=>globalThis.__placesNavigation?.state))==='success')return page}throw Error('Navigation did not reach requested page')}
;(async()=>{
 mini=await bounded(automator.connect({wsEndpoint:'ws://127.0.0.1:9432'}),'connect')
 const send=mini.connection.send.bind(mini.connection);mini.connection.send=(m,p)=>{report.lastMethod=m;return bounded(send(m,p),m)}
 report.runtime=await mini.evaluate(()=>({build:globalThis.__FLIGHTOR_BUILD__,appId:wx.getAccountInfoSync().miniProgram.appId,SDKVersion:wx.getSystemInfoSync().SDKVersion}))
 assert.equal(report.runtime.build.sourceFingerprint,JSON.parse(fs.readFileSync('dist/build-info.json')).sourceFingerprint)
 original=await mini.currentPage();originalLocale=await mini.evaluate(()=>wx.getStorageSync('flightor:locale')||'zh')
 guest=!await mini.evaluate(()=>!!wx.getStorageSync('flightor:profile'));if(await mini.evaluate(()=>wx.getStorageSync('flightor:profile')?.uid==='places-fixture')){guest=true;storage=JSON.parse(fs.readFileSync(path.join(output,'guest-storage-backup.json'),'utf8'))}
 if(guest&&!storage){
  console.log('Prepare synthetic guest transport')
  storage=await mini.evaluate(()=>wx.getStorageInfoSync().keys.map(k=>[k,wx.getStorageSync(k)]))
  fs.writeFileSync(path.join(output,'guest-storage-backup.json'),JSON.stringify(storage))
  await mini.mockWxMethod('login',{code:'places-fixture-not-real-wechat-code'})
  await mini.mockWxMethod('request',function(options,token){return{statusCode:200,data:options.url.includes('/auth/wechat')?{accessToken:token,refreshToken:'places-fixture-refresh',user:{id:'places-fixture',nickname:'Place map fixture',avatarUrl:''}}:{},header:{},errMsg:'request:ok'}},transport.token)
  const profile=await navigate('/pages/profile/index');await profile.waitFor(500)
  console.log('Open synthetic login sheet')
  await(await profile.$('.pr-identity .ux-text-button')).tap();await profile.waitFor(200)
  await(await profile.$('.login-sheet__confirm')).tap();await profile.waitFor(600)
  assert.equal(await mini.evaluate(()=>wx.getStorageSync('flightor:profile').uid),'places-fixture')
  console.log('Synthetic identity ready')
  await mini.restoreWxMethod('request')
 }
 const entries=await Promise.all(transport.entries.map(async e=>({...e,enrichment:await fetch(`${transport.baseUrl}/v1/artifacts/${e.guides.zh.id}/places`,{headers:{authorization:'Bearer '+transport.token}}).then(async r=>{assert.equal(r.status,200,'authenticated live place read');const data=await r.json();assert.ok(data.enrichment?.contentVersion);return data})})))
 await mini.mockWxMethod('request',function(options,entries){
  const raw=options.url.replace(/^https?:\/\/[^/]+/,''),url=raw.split('?')[0],locale=/[?&]locale=en(?:&|$)/.test(raw)?'en':'zh'
  globalThis.__placesCalls=globalThis.__placesCalls||[];globalThis.__placesCalls.push({url,method:options.method||'GET'})
  let data
  for(const e of entries){if(url===`/v1/artifacts/${e.guides.zh.id}/places`)data=e.enrichment
   else if(url===`/v1/artifacts/${e.guides.zh.id}`)data={artifact:e.guides[locale]}
   else if(url===`/v1/artifacts/${e.route.id}`)data={artifact:e.route}
   else if(e.flight&&url===`/v1/artifacts/${e.flight.id}`)data={artifact:e.flight}
   else if(url===`/v1/trips/${e.workspace.trip.id}/workspace`)data=e.workspace}
  return{statusCode:data?200:409,data:data||{error:{code:'UNEXPECTED_FIXTURE_REQUEST'}},header:{'content-type':'application/json'},errMsg:'request:ok'}
 },entries)
 const before=await fetch(transport.baseUrl+'/fixture/metrics').then(r=>r.json())
 for(const entry of transport.entries){
  console.log('Verify',entry.id)
  let page=await navigate(`/pages/route/index?artifactId=${entry.guides.zh.id}`);await bounded(page.waitFor('.ux-locale-toggle'),'accepted page')
  const states=[]
  for(const locale of ['zh','en']){
   const toggle=await page.$('.ux-locale-toggle'),label=await toggle.text()
   if((locale==='zh'&&label==='中文')||(locale==='en'&&label==='English')){await toggle.tap();await page.waitFor(900)}
   assert.ok(await page.$('.ux-publication-state--accepted'))
   if(locale==='zh'&&!followup){await(await page.$('.ux-prepare-places')).tap();await page.waitFor(1000)}
   await shot(`${entry.id}-${locale}-overview`)
   await(await page.$$('.ux-tab'))[1].tap();await page.waitFor(300)
   for(let d=0;d<2;d++){
    await(await page.$$('.ux-day-chip'))[d].tap();await page.waitFor(500)
    const native=await page.$(`#map-${d+1}`),map=native?await native.$('map'):await page.$('map'),expected=entry.guides[locale].payload.days[d]
    if(!native&&(entry.id==='selectedFlight'||d===1)){const frame=await page.$('.trip-map-frame');report.nativeTree=frame?await frame.outerWxml():'no frame'}
    let markers=[]
    if(native){await page.waitFor(1500);markers=await native.data('markers');report.nativeMarkerSample=markers;assert.ok(Array.isArray(markers)&&markers.length,'native component marker array must be populated')
     for(const marker of markers){assert.ok(marker.latitude>35&&marker.latitude<36);assert.ok(marker.longitude>139&&marker.longitude<140)}
     const number=Number(markers[0].label.content);assert.ok(number>=1&&number<=expected.items.length)
     if(map)await map.trigger('markertap',{markerId:markers[0].id});else await native.callMethod('selectMarker',{detail:{markerId:markers[0].id}});await page.waitFor(400)
     assert.ok((await text(page,'.ux-sheet')).includes(expected.items[number-1].title));await shot(`${entry.id}-${locale}-day${d+1}-marker-detail`)
     await(await page.$('.ux-sheet-close')).tap();await page.waitFor(200)
     const selected=await page.$('.ux-activity.is-map-selected');assert.ok(selected)
     await(await page.$$('.ux-activity'))[number-1].tap();await page.waitFor(150);await(await page.$('.ux-sheet-close')).tap()
    }else assert.ok(await page.$('.ux-map-compact'))
    assert.equal(markers.length,(entry.id==='selfTicket'?[0,1]:[1,2])[d],'confirmed POIs must reach the native map')
    await page.waitFor(1000);await shot(`${entry.id}-${locale}-day${d+1}`)
    states.push({locale,day:d+1,markers,text:await text(page,'.ux-day-content'),diagnostics:await mini.evaluate(()=>globalThis.__FLIGHTOR_MAP_DIAGNOSTICS__||[])})
    if(locale==='en'&&d===1&&markers.length){const hide=await page.$('.trip-map-hide');assert.ok(hide,'latest compact fallback action');await hide.tap();await page.waitFor(300);assert.ok(await page.$('.ux-map-compact'));await shot(`${entry.id}-en-map-collapsed`)}
   }
   await(await page.$$('.ux-tab'))[0].tap();await page.waitFor(200)
  }
  page=await navigate(`/pages/route/index?artifactId=${entry.guides.zh.id}`);await page.waitFor(1000);assert.ok(await page.$('.ux-publication-state--accepted'))
  report.cases.push({id:entry.id,states,refresh:true})
 }
 const after=await fetch(transport.baseUrl+'/fixture/metrics').then(r=>r.json());assert.equal(after.calls,before.calls)
 report.queriesBefore=before.calls;report.queriesAfter=after.calls;report.interactionChecksPassed=true
 report.basemap='requires independent visual inspection; marker/line rendering is separate'
})().catch(async e=>{report.failure=e.stack;process.exitCode=1;console.error(e);if(mini)try{await shot(`failure-${Date.now()}`)}catch{}}).finally(async()=>{
 if(mini)try{
  report.requests=await mini.evaluate(()=>globalThis.__placesCalls||[])
  await mini.restoreWxMethod('request');await mini.evaluate(()=>{delete globalThis.__placesCalls})
  if(guest&&storage){
   await mini.mockWxMethod('showModal',{confirm:true,cancel:false})
   const page=await navigate('/pages/profile/index');if(!await page.$('.pr-logout'))await(await page.$('.ux-header .ux-icon-button')).tap();await page.waitFor(200)
   const logout=await page.$('.pr-logout');if(logout){await logout.tap();await page.waitFor(1000)}
   assert.equal(await mini.evaluate(()=>!!wx.getStorageSync('flightor:profile')),false)
   await mini.evaluate(saved=>{for(const k of wx.getStorageInfoSync().keys)wx.removeStorageSync(k);for(const[k,v]of saved)wx.setStorageSync(k,v)},storage)
   for(const method of ['login','request','showModal'])await mini.restoreWxMethod(method)
  }else{const page=await mini.currentPage(),toggle=await page.$('.ux-locale-toggle');if(toggle){const label=await toggle.text();if((originalLocale==='zh'&&label==='中文')||(originalLocale==='en'&&label==='English'))await toggle.tap()}}
  if(original)await navigate('/'+original.path);report.cleanup='Original guest/user identity, storage, locale and page restored; request override removed'
 }catch(e){report.cleanupError=String(e);process.exitCode=1}finally{mini.disconnect()}
 fs.writeFileSync(path.join(output,report.failure||report.cleanupError?`failure-${Date.now()}.json`:'report.json'),JSON.stringify(report,null,2))
})
