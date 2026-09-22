const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const automator=require('miniprogram-automator')
const {fixtures}=require('./publication-ui-fixture.cjs')
const entries=fixtures(),output=path.resolve('output/weapp/publication-ui')
fs.mkdirSync(output,{recursive:true})
const report={scope:'Actual production WeChat DevTools pages; fixture request transport; existing identity unchanged; not a real device or paid backend run',recordedAt:new Date().toISOString(),build:JSON.parse(fs.readFileSync('dist/build-info.json','utf8')),cases:[]}
let mini,original,originalLocale
const bounded=async(p,label)=>{let timer;try{return await Promise.race([p,new Promise((_,no)=>timer=setTimeout(()=>no(Error(`${label} timed out`)),20000))])}finally{clearTimeout(timer)}}
const text=async(page,selector='.ux-published')=>{const el=await page.$(selector);assert.ok(el,`Missing ${selector}`);return(await el.text()).replace(/\s+/g,' ').trim()}
const clean=value=>assert.doesNotMatch(value,/https?:\/\/|EVIDENCE_ONLY|AUDIT_NOTICE_ONLY|source_reference|门票200|Open 09:00|资料标题：|来源条目摘录：/)
const screenshot=name=>mini.screenshot({path:path.join(output,`${name}.png`)})
async function language(page,locale){const toggle=await page.$('.ux-locale-toggle');assert.ok(toggle);const current=await toggle.text();if((locale==='en'&&current==='English')||(locale==='zh'&&current==='中文')){await toggle.tap();await page.waitFor(650)}}
async function inspect(entry,locale,phase){
 const page=await mini.reLaunch(`/pages/route/index?artifactId=${entry.guides.zh.id}`);await page.waitFor(1000);await language(page,locale)
 const overview=await text(page);clean(overview);assert.ok(overview.includes(entry.guides[locale].payload.publication.overview.replace(/\s+/g,' ')))
 assert.ok(overview.includes(entry.id==='selfTicket'?(locale==='zh'?'机票自备':'Flights arranged independently'):(locale==='zh'?'已采用航班':'Selected flight')))
 await screenshot(`${entry.id}-${phase}-overview`)
 await(await page.$$('.ux-tab'))[1].tap();await page.waitFor(150)
 const details=[]
 for(let d=0;d<2;d++){
  await(await page.$$('.ux-day-chip'))[d].tap();await page.waitFor(100)
  assert.ok((await text(page)).includes(entry.guides[locale].payload.days[d].theme))
  for(let i=0;i<2;i++){
   await(await page.$$('.ux-activity'))[i].tap();await page.waitFor(300)
   const detail=await text(page,'.ux-sheet');clean(detail)
   const expected=entry.guides[locale].payload.days[d].items[i]
   assert.ok(detail.includes(expected.description));assert.ok(detail.includes(expected.recommendationReason));assert.ok(detail.includes(locale==='zh'?'为什么推荐':'Why this fits your trip'))
   if(i===0)await screenshot(`${entry.id}-${phase}-day${d+1}-detail`)
   details.push(detail);await(await page.$('.ux-sheet-close')).tap();await page.waitFor(100)
  }
 }
 await screenshot(`${entry.id}-${phase}-days`)
 await(await page.$$('.ux-tab'))[2].tap();await page.waitFor(300)
 const flights=await text(page);clean(flights)
 if(locale==='en')assert.doesNotMatch(flights,/时间未提供|价格待确认|航段与中转/)
 if(entry.id==='selectedFlight'){assert.ok(await page.$('.ux-ticket'));assert.ok(flights.includes(locale==='zh'?'航段与中转':'Flight legs and connections'))}
 else assert.equal(await page.$('.ux-ticket'),null)
 await screenshot(`${entry.id}-${phase}-flights`)
 return {overview,details}
}
;(async()=>{
 mini=await bounded(automator.connect({wsEndpoint:process.env.FLIGHTOR_WEAPP_WS||'ws://127.0.0.1:9432'}),'connect')
 const send=mini.connection.send.bind(mini.connection);mini.connection.send=(method,params)=>bounded(send(method,params),method)
 original=await mini.currentPage();originalLocale=await mini.evaluate(()=>wx.getStorageSync('flightor:locale')||'zh')
 assert.equal(await mini.evaluate(()=>!!wx.getStorageSync('flightor:profile')),true,'An existing signed-in simulator is required; identity is not replaced')
 await mini.mockWxMethod('request',function(options,entries){
  const raw=options.url.replace(/^https?:\/\/[^/]+/,''),url=raw.split('?')[0],locale=/[?&]locale=en(?:&|$)/.test(raw)?'en':'zh',method=options.method||'GET'
  globalThis.__publicationUiCalls=globalThis.__publicationUiCalls||[];globalThis.__publicationUiStates=globalThis.__publicationUiStates||{}
  let data,statusCode=200
  for(const entry of entries){
   const base=`/v1/artifacts/${entry.guides.zh.id}`
   if(url.startsWith(base)){
    const id=url.replace('/v1/artifacts/','').replace('/localization',''),suffix=id.slice(entry.guides.zh.id.length)
    const state=globalThis.__publicationUiStates[id]||(suffix==='-retry'?'retryable':suffix==='-prepare'?'preparing':suffix==='-revision'?'revision_required':suffix==='-legacy'?'legacy':'accepted')
    const target=method==='POST'?options.data.locale:locale,guide=JSON.parse(JSON.stringify(entry.guides[target]));guide.id=id;guide.payload.publication.artifactId=id
    if(method==='POST'){
     if(target!=='en'||!(state==='retryable'&&options.data.retryRevision===1||state==='preparing'&&options.data.retryRevision===undefined)){statusCode=409;data={code:'FIXTURE_BAD_RETRY'};break}
     globalThis.__publicationUiStates[id]='accepted'
    }else if(target==='en'&&state!=='accepted'){
     Object.assign(guide.payload.publication,{status:state==='preparing'?'preparing':'blocked',failureKind:state,canRetry:state==='retryable',legacy:state==='legacy',issues:state==='revision_required'?[{activityId:guide.payload.days[0].items[0].id,code:'conflict',detail:'Closed on travel date'}]:[],overview:undefined});guide.payload.days=[]
    }
    data={artifact:guide};break
   }
   if(url===`/v1/artifacts/${entry.route.id}`)data={artifact:entry.route}
   if(entry.flight&&url===`/v1/artifacts/${entry.flight.id}`)data={artifact:entry.flight}
   if(url===`/v1/trips/${entry.workspace.trip.id}/workspace`)data=entry.workspace
  }
  if(!data){statusCode=409;data={code:'FIXTURE_UNEXPECTED_REQUEST'}}
  globalThis.__publicationUiCalls.push({url,locale,method,statusCode})
  return{data,statusCode,header:{'content-type':'application/json'},errMsg:'request:ok'}
 },entries)
 for(const entry of entries){
  const zh=await inspect(entry,'zh','zh'),zhRestored=await inspect(entry,'zh','zh-restored');assert.deepEqual(zhRestored,zh)
  const en=await inspect(entry,'en','en'),enRestored=await inspect(entry,'en','en-restored');assert.deepEqual(enRestored,en)
  const before=await mini.evaluate(()=>globalThis.__publicationUiCalls.filter(r=>r.method==='POST').length)
  let page=await mini.reLaunch(`/pages/route/index?artifactId=${entry.guides.en.id}-retry`);await page.waitFor(700)
  assert.ok(await page.$('.ux-retry-locale'));await screenshot(`${entry.id}-retryable`)
  await(await page.$('.ux-refresh-status')).tap();await page.waitFor(700)
  assert.equal(await mini.evaluate(()=>globalThis.__publicationUiCalls.filter(r=>r.method==='POST').length),before)
  await(await page.$('.ux-retry-locale')).tap();await page.waitFor(900);assert.ok(await page.$('.ux-publication-state--accepted'))
  page=await mini.reLaunch(`/pages/route/index?artifactId=${entry.guides.en.id}-retry`);await page.waitFor(700);assert.ok(await page.$('.ux-publication-state--accepted'))
  assert.equal(await mini.evaluate(()=>globalThis.__publicationUiCalls.filter(r=>r.method==='POST').length),before+1)
  page=await mini.reLaunch(`/pages/route/index?artifactId=${entry.guides.en.id}-prepare`);await page.waitFor(700);assert.ok(await page.$('.ux-prepare-locale'));await screenshot(`${entry.id}-preparing`)
  await(await page.$('.ux-prepare-locale')).tap();await page.waitFor(900);assert.ok(await page.$('.ux-publication-state--accepted'))
  for(const state of ['revision','legacy']){page=await mini.reLaunch(`/pages/route/index?artifactId=${entry.guides.en.id}-${state}`);await page.waitFor(700);assert.equal(await page.$('.ux-retry-locale'),null);await screenshot(`${entry.id}-${state}`)}
  report.cases.push({id:entry.id,zh,en,refreshEqual:true,explicitRetry:true})
 }
 report.requests=await mini.evaluate(()=>globalThis.__publicationUiCalls)
 assert.equal(report.requests.filter(r=>r.method==='POST').length,4)
 assert.ok(report.requests.every(r=>r.statusCode===200))
})().catch(async e=>{report.failure=e.stack;process.exitCode=1;console.error(e);if(mini){try{const p=await mini.currentPage();report.failureText=await text(p,'.ux-app');report.requests=await mini.evaluate(()=>globalThis.__publicationUiCalls||[]);await screenshot(`failure-${Date.now()}`)}catch{}}}).finally(async()=>{
 if(mini){try{const page=await mini.currentPage();if(await page.$('.ux-locale-toggle'))await language(page,originalLocale);await mini.restoreWxMethod('request');await mini.evaluate(()=>{delete globalThis.__publicationUiCalls;delete globalThis.__publicationUiStates});if(original)await mini.reLaunch('/'+original.path);report.cleanup='request mock removed, original locale/page restored; user identity untouched'}catch(e){report.cleanupError=String(e);process.exitCode=1}mini.disconnect()}
 fs.writeFileSync(path.join(output,report.failure||report.cleanupError?`failure-${Date.now()}.json`:'report.json'),JSON.stringify(report,null,2))
})
