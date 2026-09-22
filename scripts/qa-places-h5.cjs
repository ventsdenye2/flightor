const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright')
const transport=JSON.parse(fs.readFileSync('backend/.demo/places-map-20260922/transport.json','utf8'))
const output=path.resolve('output/playwright/places-map');fs.mkdirSync(output,{recursive:true})
const report={scope:'Production H5 components; synthetic accepted trip/text; real authenticated place API/PostgreSQL; preserved real Nominatim identities; live OSM tiles',requests:[],tiles:[],cases:[],recordedAt:new Date().toISOString()}
;(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'})
 try{for(const entry of transport.entries){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(12000)
  await context.addInitScript(()=>{localStorage.setItem('flightor:locale',JSON.stringify({data:'zh'}));localStorage.setItem('flightor:profile',JSON.stringify({data:{uid:'places-ui-fixture',nickname:'Places fixture'}}));localStorage.setItem('access_token',JSON.stringify({data:'fixture'}))})
  await context.route('**/v1/**',async route=>{
   const req=route.request(),u=new URL(req.url()),r=await fetch(transport.baseUrl+u.pathname+u.search,{method:req.method(),headers:{authorization:'Bearer '+transport.token,'content-type':'application/json'},...(req.method()==='POST'?{body:req.postData()}: {})})
   report.requests.push({entry:entry.id,path:u.pathname,method:req.method(),status:r.status});await route.fulfill({status:r.status,contentType:'application/json',body:await r.text()})
  })
  page.on('response',r=>{if(r.url().startsWith('https://tile.openstreetmap.org/'))report.tiles.push({status:r.status(),url:r.url()})})
  await page.goto(`http://127.0.0.1:10086/#/pages/route/index?artifactId=${entry.guides.zh.id}`);await page.locator('.ux-publication-state--accepted').waitFor()
  const before=await fetch(transport.baseUrl+'/fixture/metrics').then(r=>r.json())
  await page.locator('.ux-prepare-places').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${entry.id}-before-explicit-resolution.png`)})
  await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/places')),page.locator('.ux-prepare-places').click()])
  const resolved=await fetch(transport.baseUrl+'/fixture/metrics').then(r=>r.json())
  await page.locator('.trip-map-frame[data-map-ready="true"]').waitFor()
  await page.locator('.trip-map-frame').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${entry.id}-zh-overview.png`)})
  const observations=[]
  for(const locale of ['zh','en']){
   if(locale==='en'){await page.locator('.ux-locale-toggle').click();await page.locator('.ux-publication-state--accepted').waitFor()}
   await page.locator('.ux-tab').nth(1).click()
   for(let day=0;day<2;day++){
    await page.locator('.ux-day-chip').nth(day).click();await page.locator('.ux-day-title').waitFor()
    const expected=entry.guides[locale].payload.days[day],markers=page.locator('.leaflet-marker-icon')
    const title=await page.locator('.ux-day-title').innerText();assert.ok(title.includes(expected.theme))
    const count=await markers.count()
    if(count){
     await page.locator('[data-map-ready="true"]').waitFor();await page.locator('.trip-map-frame').scrollIntoViewIfNeeded()
     const number=Number(await markers.first().innerText());assert.ok(number>=1&&number<=expected.items.length)
     await markers.first().click();await page.locator('.ux-sheet').waitFor();assert.ok((await page.locator('.ux-sheet').innerText()).includes(expected.items[number-1].title))
     await page.screenshot({path:path.join(output,`${entry.id}-${locale}-day${day+1}-marker-detail.png`)})
     await page.locator('.ux-sheet-close').click();assert.equal(await page.locator('.ux-activity.is-map-selected').getAttribute('data-activity-id'),expected.items[number-1].id)
     await page.locator('.ux-activity').nth(number-1).click();await page.locator('.ux-sheet-close').click();assert.equal(await page.locator('.trip-map-pin.is-selected').count(),1)
    }else assert.ok(await page.locator('.ux-map-compact').count())
    await page.screenshot({path:path.join(output,`${entry.id}-${locale}-day${day+1}.png`)})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    observations.push({locale,day:day+1,markers:count,text:await page.locator('.ux-day-content').innerText()})
   }
  }
  await page.reload();await page.locator('.ux-publication-state--accepted').waitFor();await page.locator('[data-map-ready="true"]').waitFor()
  const after=await fetch(transport.baseUrl+'/fixture/metrics').then(r=>r.json());assert.equal(after.calls,resolved.calls)
  assert.equal(report.requests.filter(r=>r.entry===entry.id&&r.method==='POST').length,1)
  report.cases.push({id:entry.id,observations,refreshLocale:'en',queriesBefore:before.calls,queriesAfterExplicit:resolved.calls,queriesAfter:after.calls})
  await context.close()
 }
 assert.ok(report.tiles.some(t=>t.status===200));report.passed=true
 }finally{await browser.close()}
})().catch(e=>{report.failure=e.stack;process.exitCode=1;console.error(e)}).finally(()=>fs.writeFileSync(path.join(output,report.failure?`failure-${Date.now()}.json`:'report.json'),JSON.stringify(report,null,2)))
