import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {chromium} from 'playwright';
import {SessionStore} from '../src/browser/session.js';

test('Trip.com cookies and local storage survive closing the context; Google state is excluded',async()=>{
  const root=await mkdtemp(join(tmpdir(),'trip-session-test-'));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const store=new SessionStore(join(root,'auth','trip.json'));
  try {
    assert.equal(await store.load(),undefined);
    const first=await browser.newContext();
    await first.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<main>Local session fixture</main>'}));
    await first.addCookies([
      {name:'fixture-trip-session',value:'trip-fixture',domain:'.trip.com',path:'/',expires:Math.floor(Date.now()/1000)+3600},
      {name:'fixture-google-session',value:'google-fixture',domain:'.google.com',path:'/'},
    ]);
    const page=await first.newPage();
    await page.goto('https://www.trip.com/');await page.evaluate(()=>localStorage.setItem('fixture','trip-local'));
    await page.goto('https://accounts.google.com/');await page.evaluate(()=>localStorage.setItem('fixture','google-local'));
    await store.save(first);await first.close();
    const saved=await readFile(store.path,'utf8');
    assert.ok(!saved.includes('google-fixture'));assert.ok(!saved.includes('google-local'));assert.ok(!saved.includes('google.com'));
    const second=await browser.newContext({storageState:await store.load()});
    await second.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<main>Local session fixture</main>'}));
    assert.equal((await second.cookies('https://www.trip.com/')).find(c=>c.name==='fixture-trip-session')?.value,'trip-fixture');
    assert.equal((await second.cookies('https://accounts.google.com/')).length,0);
    const restored=await second.newPage();await restored.goto('https://www.trip.com/');
    assert.equal(await restored.evaluate(()=>localStorage.getItem('fixture')),'trip-local');
    await store.save(second);await second.close();
    assert.ok(await store.load());
  }finally{
    await browser.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true});
  }
});
