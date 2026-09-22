const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { chromium } = require('playwright')
const { fixtures } = require('./publication-ui-fixture.cjs')
const output = path.resolve('output/playwright/publication-ui')
fs.mkdirSync(output, {recursive:true})
const report = { scope:'Actual production H5 components; frozen API transport; no model/provider calls or real authentication', browser:'Installed Chrome', recordedAt:new Date().toISOString(), cases:[], requests:[] }
const clean = text => { assert.doesNotMatch(text,/https?:\/\/|EVIDENCE_ONLY|AUDIT_NOTICE_ONLY|source_reference|门票200|Open 09:00|资料标题：|来源条目摘录：|as an AI|I will now/) }
;(async()=>{
 const browser = await chromium.launch({headless:true,channel:'chrome'})
 try {
  for (const entry of fixtures()) {
   const context = await browser.newContext({viewport:{width:390,height:844}})
   let english = 'accepted', delay = false
   const page = await context.newPage(); page.setDefaultTimeout(12000)
   await context.addInitScript(()=>{if(!localStorage.getItem('flightor:locale'))localStorage.setItem('flightor:locale',JSON.stringify({data:'zh'}));localStorage.setItem('flightor:profile',JSON.stringify({data:{uid:'publication-ui-fixture',nickname:'UI fixture'}}));localStorage.setItem('access_token',JSON.stringify({data:'fixture'}))})
   await context.route('**/v1/**', async route => {
    const request=route.request(), url=new URL(request.url()), locale=url.searchParams.get('locale')||'zh', method=request.method()
    let data, status=200
    if (url.pathname.endsWith('/localization')) {
      const body=request.postDataJSON(); assert.equal(body.locale,'en'); assert.ok(english==='preparing'||english==='retryable')
      if(english==='retryable')assert.equal(body.retryRevision,1);else assert.equal(body.retryRevision,undefined)
      if(delay)await new Promise(resolve=>setTimeout(resolve,650))
      english='accepted';data={artifact:entry.guides.en}
    } else if(url.pathname.endsWith('/workspace'))data={...entry.workspace,messages:entry.workspace.messages.map(m=>m.role==='assistant'?{...m,content:entry.guides[locale].payload.publication.reply}:m)}
    else if(url.pathname===`/v1/artifacts/${entry.route.id}`)data={artifact:entry.route}
    else if(entry.flight&&url.pathname===`/v1/artifacts/${entry.flight.id}`)data={artifact:entry.flight}
    else if(url.pathname===`/v1/artifacts/${entry.guides.zh.id}`){const guide=structuredClone(entry.guides[locale]);if(locale==='en'&&english!=='accepted'){
      Object.assign(guide.payload.publication,{status:english==='preparing'?'preparing':'blocked',failureKind:english,canRetry:english==='retryable',issues:english==='revision_required'?[{activityId:guide.payload.days[0].items[0].id,code:'conflict',detail:'Closed on travel date'}]:[],overview:undefined});guide.payload.days=[];
    }data={artifact:guide}}
    else {status=409;data={code:'UNEXPECTED_FIXTURE_REQUEST'}}
    report.requests.push({case:entry.id,path:url.pathname,locale,method,status})
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)})
   })
   const url=`http://127.0.0.1:10086/#/pages/route/index?artifactId=${entry.guides.zh.id}`
   await page.goto(url);await page.locator('.ux-publication-state--accepted').waitFor()
   const texts=[]
   async function inspect(locale, phase) {
    await page.locator('.ux-publication-state--accepted').waitFor()
    const body=await page.locator('.ux-published').innerText();clean(body);assert.ok(body.includes(entry.guides[locale].payload.publication.overview))
    const layout=await page.locator('.ux-header-title').evaluate(el=>({height:el.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>innerWidth}))
    assert.ok(layout.height<32,'Header stays on one line');assert.equal(layout.overflow,false,'No horizontal overflow')
    if(entry.id==='selfTicket')assert.ok(body.includes(locale==='zh'?'机票自备':'Flights arranged independently'))
    if(entry.id==='selectedFlight')assert.ok(body.includes(locale==='zh'?'已采用航班':'Selected flight'))
    await page.screenshot({animations:'disabled',path:path.join(output,`${entry.id}-${phase}-overview.png`)})
    await page.locator('.ux-tab').nth(1).click()
    for(let day=0;day<2;day++){
     await page.locator('.ux-day-chip').nth(day).click()
     const expected=entry.guides[locale].payload.days[day]
     assert.ok((await page.locator('.ux-day-title').innerText()).includes(expected.theme))
     for(let i=0;i<expected.items.length;i++){
      await page.locator('.ux-activity').nth(i).click()
      const detail=await page.locator('.ux-sheet').innerText();clean(detail)
      assert.ok(detail.includes(expected.items[i].description));assert.ok(detail.includes(expected.items[i].recommendationReason))
      assert.ok(detail.includes(locale==='zh'?'为什么推荐':'Why this fits your trip'))
      assert.doesNotMatch(detail,/activity|source_reference|开放情况、交通与具体时刻/)
      if(i===0)await page.screenshot({animations:'disabled',path:path.join(output,`${entry.id}-${phase}-day${day+1}-detail.png`)})
      await page.locator('.ux-sheet-close').click();texts.push(detail)
     }
    }
    await page.screenshot({animations:'disabled',path:path.join(output,`${entry.id}-${phase}-days.png`)})
    await page.locator('.ux-tab').nth(2).click()
    const flightText=await page.locator('.ux-published').innerText();clean(flightText)
    if(locale==='en')assert.doesNotMatch(flightText,/时间未提供|价格待确认|航段与中转/)
    if(entry.id==='selectedFlight') { assert.ok(await page.locator('.ux-ticket').count());assert.ok(flightText.includes(locale==='zh'?'航段与中转':'Flight legs and connections')) }
    else assert.equal(await page.locator('.ux-ticket').count(),0)
    await page.screenshot({animations:'disabled',path:path.join(output,`${entry.id}-${phase}-flights.png`)})
    await page.locator('.ux-tab').first().click()
   }
   await inspect('zh','zh');const callsBefore=report.requests.filter(r=>r.method==='POST').length
   await page.reload();await inspect('zh','zh-restored')
   await page.locator('.ux-locale-toggle').click();await inspect('en','en')
   await page.setViewportSize({width:320,height:740});await page.reload();await inspect('en','en-narrow-restored')
   assert.equal(report.requests.filter(r=>r.method==='POST').length,callsBefore)
   english='retryable';await page.reload();await page.locator('.ux-retry-locale').waitFor()
   await page.screenshot({animations:'disabled',path:path.join(output,`${entry.id}-retryable.png`)})
   await page.locator('.ux-refresh-status').click();await page.locator('.ux-retry-locale').waitFor()
   assert.equal(report.requests.filter(r=>r.method==='POST').length,callsBefore)
   delay=true;await page.locator('.ux-retry-locale').click();await page.locator('.ux-locale-toggle').click()
   await page.locator('.ux-publication-state--accepted').waitFor();await page.waitForTimeout(900)
   assert.ok((await page.locator('.ux-published').innerText()).includes('行程已准备好'))
   await page.locator('.ux-locale-toggle').click();await page.locator('.ux-publication-state--accepted').waitFor()
   assert.equal(report.requests.filter(r=>r.method==='POST').length,callsBefore+1)
   await page.reload();await page.locator('.ux-publication-state--accepted').waitFor()
   english='preparing';await page.reload();await page.locator('.ux-prepare-locale').waitFor()
   await page.screenshot({animations:'disabled',path:path.join(output,`${entry.id}-preparing.png`)})
   assert.equal(report.requests.filter(r=>r.method==='POST').length,callsBefore+1)
   delay=false;await page.locator('.ux-prepare-locale').click();await page.locator('.ux-publication-state--accepted').waitFor()
   english='revision_required';await page.reload();await page.locator('.ux-publication-state--revision_required').waitFor()
   assert.equal(await page.locator('.ux-retry-locale').count(),0);assert.equal(await page.locator('.ux-prepare-locale').count(),0)
   assert.match(await page.locator('.ux-issue').first().innerText(),/closed|closure/i)
   await page.screenshot({animations:'disabled',path:path.join(output,`${entry.id}-revision-required.png`)})
   english='accepted';entry.guides.en.payload.publication.legacy=true;await page.reload();await page.locator('.ux-publication-state--legacy').waitFor()
   await page.screenshot({animations:'disabled',path:path.join(output,`${entry.id}-legacy.png`)})
   report.cases.push({id:entry.id,detailAssertions:texts.length,passed:true});await context.close()
  }
 }finally{await browser.close()}
})().catch(e=>{report.failure=e.stack;process.exitCode=1;console.error(e)}).finally(()=>{fs.writeFileSync(path.join(output,report.failure?`failure-${Date.now()}.json`:'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.cases))})
