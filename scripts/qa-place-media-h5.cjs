// Formal components + adapter, isolated accepted fixture text, real media API/DB/remote photos.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright')
const transport=JSON.parse(fs.readFileSync('backend/.demo/place-media/transport.json','utf8'))
const output=path.resolve('output/playwright/place-media');fs.mkdirSync(output,{recursive:true})
const report={scope:'Production H5; isolated fixture accepted trip/text; real media API/PostgreSQL/Wikimedia images; maps unavailable; not production account or physical device',requests:[],images:[],startedAt:new Date().toISOString()}
const metrics=()=>fetch(transport.baseUrl+'/fixture/metrics').then(r=>r.json())
;(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,proxy:{server:'http://127.0.0.1:7890',bypass:'127.0.0.1,localhost'}})
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000)
  const entry=transport.entries.find(e=>e.id==='selectedFlight');let release,delay=true
  const gate=new Promise(r=>{release=r})
  await context.addInitScript(()=>{localStorage.setItem('flightor:locale',JSON.stringify({data:'zh'}));localStorage.setItem('flightor:profile',JSON.stringify({data:{uid:'media-ui-fixture',nickname:'Media fixture'}}));localStorage.setItem('access_token',JSON.stringify({data:'fixture'}))})
  await context.route('**/v1/**',async route=>{
   const req=route.request(),u=new URL(req.url());if(delay&&u.pathname.endsWith('/media'))await gate
   const r=await fetch(transport.baseUrl+u.pathname+u.search,{method:req.method(),headers:{authorization:'Bearer '+transport.token,'content-type':'application/json'},...(req.method()==='POST'?{body:req.postData()}: {})})
   report.requests.push({path:u.pathname,method:req.method(),status:r.status});await route.fulfill({status:r.status,contentType:'application/json',body:await r.text()})
  })
  page.on('response',r=>{if(/^https:\/\/(thumb|upload)\.wikimedia\.org/.test(r.url()))report.images.push({url:r.url(),status:r.status()})})
  report.before=await metrics()
  await page.goto(`http://127.0.0.1:10087/#/pages/route/index?artifactId=${entry.guides.zh.id}`)
  await page.locator('.ux-publication-state--accepted').waitFor()
  await page.locator('.ux-tab').nth(1).click();await page.locator('.ux-day-chip').nth(1).click();await page.locator('.ux-activity').first().click()
  await page.locator('.ux-sheet').waitFor();report.titleBefore=await page.locator('.ux-detail-title').innerText();assert.equal(await page.locator('.ux-detail-photo').count(),0)
  await page.screenshot({animations:'disabled',path:path.join(output,'text-before-media.png')});delay=false;release()
  async function decoded(selector){const locator=page.locator(selector).first();await locator.waitFor();await page.waitForFunction(sel=>{const el=document.querySelector(sel);const im=el?.tagName==='IMG'?el:el?.querySelector('img');return !!im&&im.complete&&im.naturalWidth>0},selector);return locator.evaluate(el=>{const im=el.tagName==='IMG'?el:el.querySelector('img');return{src:im.currentSrc,width:im.naturalWidth,height:im.naturalHeight}})}
  report.ueno=await decoded('.ux-detail-photo');assert.equal(await page.locator('.ux-detail-title').innerText(),report.titleBefore);assert.equal(await page.locator('.ux-day-chip.is-active').innerText(),'第 2 天')
  await page.screenshot({animations:'disabled',path:path.join(output,'ueno-detail.png')});await page.locator('.ux-sheet-close').click()
  report.thumbnail=await decoded('.ux-thumbnail');await page.screenshot({animations:'disabled',path:path.join(output,'day2-thumbnails.png')})
  await page.locator('.ux-activity').nth(1).click();report.takeshita=await decoded('.ux-detail-photo');assert.notEqual(report.ueno.src,report.takeshita.src);await page.screenshot({animations:'disabled',path:path.join(output,'takeshita-detail.png')});await page.locator('.ux-sheet-close').click()
  await page.locator('.ux-tab').first().click();report.cover=await decoded('.ux-hero');await page.screenshot({animations:'disabled',path:path.join(output,'overview-cover.png')})
  await page.locator('.ux-locale-toggle').click();await page.locator('.ux-publication-state--accepted').waitFor();await decoded('.ux-hero');await page.screenshot({animations:'disabled',path:path.join(output,'english-cover.png')})
  await page.reload();await decoded('.ux-hero');report.after=await metrics();assert.equal(report.after.requests.length,report.before.requests.length);assert.ok(report.requests.every(r=>r.method==='GET'))
  report.restored=true;report.layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(report.layout.scrollWidth<=report.layout.width)
  // Real UI failure handling: HTML in place of a photo must collapse, leaving accepted prose.
  await context.route('https://thumb.wikimedia.org/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<html>not an image</html>'}))
  await page.reload();await page.locator('.ux-publication-state--accepted').waitFor();await page.waitForTimeout(2500)
  assert.equal(await page.locator('.ux-hero').count(),0);assert.ok((await page.locator('.ux-trip-overview').innerText()).length>20);report.nonImageCollapsed=true
  await page.screenshot({animations:'disabled',path:path.join(output,'nonimage-text-usable.png')})
  const crypto=require('node:crypto'),cp=require('node:child_process')
  report.build={baseSha:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:!!cp.execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),assets:[]}
  for(const src of await page.evaluate(()=>[...new Set([...document.scripts].map(s=>s.src).concat(performance.getEntriesByType('resource').map(r=>r.name)).filter(u=>/\.js(?:\?|$)/.test(u)))])){
   const u=new URL(src);if(u.origin!=='http://127.0.0.1:10087')continue
   const bytes=await (await page.request.get(src)).body(),local=fs.readFileSync(path.join('dist-h5',u.pathname.slice(1)))
   assert.ok(bytes.equals(local));report.build.assets.push({path:u.pathname,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})
  }
  report.passed=true
 }finally{await browser.close()}
})().catch(e=>{report.failure=e.stack;process.exitCode=1;console.error(e)}).finally(()=>fs.writeFileSync(path.join(output,report.failure?`failure-${Date.now()}.json`:'report.json'),JSON.stringify(report,null,2)))
