const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright')
const transport=JSON.parse(fs.readFileSync('backend/.demo/places-map-20260922/transport.json'))
const output=path.resolve('output/playwright/map-followup');fs.mkdirSync(output,{recursive:true})
const report={scope:'Formal H5 with cached real POI API transport; deliberately injected extension/config/tile faults; no POI or model calls',cases:[]}
;(async()=>{const browser=await chromium.launch({headless:true,channel:'chrome'})
 try{for(const fault of ['places','map-config','tiles']){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage()
  page.setDefaultTimeout(15000)
  await context.addInitScript(()=>{localStorage.setItem('flightor:locale',JSON.stringify({data:'en'}));localStorage.setItem('flightor:profile',JSON.stringify({data:{uid:'places-ui-fixture'}}));localStorage.setItem('access_token',JSON.stringify({data:'fixture'}))})
  let calls=0,posts=0
  await context.route('**/v1/**',async route=>{
   const req=route.request(),url=new URL(req.url());if(req.method()==='POST')posts++
   if(url.pathname.endsWith('/places'))calls++
   if(fault==='places'&&url.pathname.endsWith('/places')||fault==='map-config'&&url.pathname==='/v1/map-config')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'INJECTED_UNAVAILABLE',message:'Controlled map failure'}})})
   const r=await fetch(transport.baseUrl+url.pathname+url.search,{headers:{authorization:'Bearer '+transport.token}});return route.fulfill({status:r.status,contentType:'application/json',body:await r.text()})
  })
  if(fault==='tiles')await context.route('https://tile.openstreetmap.org/**',r=>r.abort('failed'))
  await page.goto('http://127.0.0.1:10086/#/pages/route/index?artifactId='+transport.entries[0].guides.en.id)
  await page.locator('.ux-publication-state--accepted').waitFor()
  if(fault==='tiles')await page.locator('.ux-map-compact').waitFor()
  else await page.waitForTimeout(1000)
  assert.ok(await page.locator('.ux-tab').count());assert.equal(posts,0);assert.equal(calls,1)
  await page.screenshot({path:path.join(output,'failure-'+fault+'.png')})
  const diagnostics=await page.evaluate(()=>globalThis.__FLIGHTOR_MAP_DIAGNOSTICS__||[])
  assert.ok(diagnostics.some(d=>d.status==='failed'&&d.layer===(fault==='tiles'?'h5-tiles':fault)))
  report.cases.push({fault,calls,posts,acceptedText:true,diagnostics});await context.close()
 }}finally{await browser.close()}
})().catch(e=>{report.failure=String(e);process.exitCode=1;console.error(e)}).finally(()=>fs.writeFileSync(path.join(output,'failure-injection.json'),JSON.stringify(report,null,2)))
