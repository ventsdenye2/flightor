const assert=require('node:assert/strict')
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const mod={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/features/ui-experience/backendClient.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:mod.exports,module:mod,Set,Error,Promise,setTimeout,encodeURIComponent})
const {createConversationClient,PlanCancellation}=mod.exports
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0))
const conversation=(id,tripId)=>({id,messages:tripId?[{id:'anchor-'+tripId,role:'assistant',trip:{id:tripId,provenance:'dsh'}}]:[]})
const restored=(id,tripId)=>({conversation:conversation(id,tripId),context:{conversationId:id,messageId:'anchor-'+tripId,runId:tripId}})
const store=(initial=null)=>{let value=initial,context=null;return {get:()=>value,set:id=>{value=id},clear:()=>{value=null},getTripContext:()=>context,setTripContext:value=>{context=value}}}
let count=0
async function check(name,work){await work();count++;console.log('PASS '+name)}
async function main(){
  await check('resume selected old trip and send only to its original conversation',async()=>{
    const storage=store('dubai'),sent=[],saved=[]
    const client=createConversationClient(async(method,route,body)=>{
      if(route==='/api/trips/shanghai/context')return restored('old-shanghai','shanghai')
      if(method==='POST'){sent.push(body);return {id:'job'}}
      if(route==='/api/runs/job')return {stage:'completed',conversation:conversation('old-shanghai','shanghai')}
      return conversation('old-shanghai','shanghai')
    },storage,id=>saved.push(id))
    await client.resumeTrip('shanghai');assert.equal(storage.get(),'old-shanghai')
    await client.send('调整上海',()=>{},new PlanCancellation().signal)
    assert.equal(sent[0].conversationId,'old-shanghai');assert.equal(saved[0],'shanghai');assert.equal(sent[0].tripContext.runId,'shanghai')
    const reloaded=createConversationClient(async(method,route,body)=>{
      if(method==='POST'){assert.equal(body.tripContext.runId,'shanghai');assert.equal(body.conversationId,'old-shanghai');return {id:'job'}}
      return {stage:'completed',conversation:conversation('old-shanghai','shanghai')}
    },storage)
    await reloaded.send('刷新后仍调整原行程',()=>{},new PlanCancellation().signal)
  })
  await check('failed resume blocks load/send instead of falling back; explicit reset starts a fresh session',async()=>{
    let posts=0;const storage=store('latest')
    const client=createConversationClient(async(method,route)=>{
      if(route.includes('/context'))throw Error('missing original')
      if(method==='POST'){posts++;return {id:'fresh'}}
      return {stage:'completed',conversation:conversation('new')}
    },storage)
    await assert.rejects(client.resumeTrip('missing'));assert.equal(storage.get(),null)
    await assert.rejects(client.load(),/恢复失败/);await assert.rejects(client.send('草稿',()=>{},new PlanCancellation().signal),/恢复失败/);assert.equal(posts,0)
    client.reset();await client.send('新旅行',()=>{},new PlanCancellation().signal);assert.equal(storage.get(),'new')
  })
  for(const kind of ['chat','search','details','selection'])await check('reset isolates late '+kind+' result and preserves the new session',async()=>{
    const late=defer(),storage=store('old');let posting=0,deletes=0,progress=0,savedTrips=0
    const client=createConversationClient(async(method,route)=>{
      if(method==='POST')return {id:++posting===1?'old-job':'new-job'}
      if(method==='DELETE'){deletes++;return {}}
      if(route==='/api/runs/old-job')return late.promise
      return {stage:'completed',conversation:conversation('new')}
    },storage,()=>savedTrips++)
    const signal=new PlanCancellation().signal,selection={searchId:'search',candidateId:'candidate'}
    const pending=kind==='chat'?client.send('旧消息',()=>progress++,signal):kind==='search'?client.searchFlights({},()=>progress++,signal):kind==='details'?client.loadFlightDetails(selection,signal):client.selectFlight(selection,signal)
    await tick();client.reset();await assert.rejects(pending,/已取消/)
    await client.send('新消息',()=>{},new PlanCancellation().signal)
    late.resolve({stage:'completed',conversation:{...conversation('old'),flightOptions:{options:[]}},trip:{id:'wrong-trip'}});await tick()
    assert.equal(storage.get(),'new');assert.equal(progress,0);assert.equal(savedTrips,0);assert.equal(deletes,1)
  })
  await check('late POST after reset is cancelled by its own task ID without polling',async()=>{
    const submitted=defer(),storage=store('old');let cancelled
    const client=createConversationClient(async(method,route)=>{
      if(method==='POST')return submitted.promise
      if(method==='DELETE'){cancelled=route;return {}}
      assert.fail('must not poll stale POST')
    },storage)
    const pending=client.send('旧请求',()=>assert.fail('stale progress'),new PlanCancellation().signal)
    client.reset();await assert.rejects(pending,/已取消/);submitted.resolve({id:'late-post'});await tick()
    assert.equal(cancelled,'/api/runs/late-post');assert.equal(storage.get(),null)
  })
  await check('late restore cannot replace a newer restore, including its saved trip pointer',async()=>{
    const a=defer(),storage=store('latest'),trips=[]
    const client=createConversationClient(async(method,route)=>route.includes('/A/')?a.promise:route.includes('/B/')?restored('B-conversation','B'):conversation('B-conversation','B'),storage,id=>trips.push(id))
    const older=client.resumeTrip('A');const rejection=assert.rejects(older,/已取消/)
    await client.resumeTrip('B');a.resolve(restored('A-conversation','A'));await rejection
    assert.equal(storage.get(),'B-conversation');assert.equal((await client.load()).id,'B-conversation');assert.deepEqual(trips,['B'])
  })
  await check('late history response and foreign task response never become current history',async()=>{
    const history=defer(),storage=store('owner')
    const client=createConversationClient(async()=>history.promise,storage)
    const pending=client.load();client.reset();history.resolve(conversation('owner'));await assert.rejects(pending,/已取消/)
    let deletes=0
    const other=createConversationClient(async method=>method==='POST'?{id:'wrong'}:method==='DELETE'?(deletes++,{}):{stage:'completed',conversation:conversation('foreign')},store('owner'))
    await assert.rejects(other.send('消息',()=>assert.fail('foreign progress'),new PlanCancellation().signal),/归属不一致/);assert.equal(deletes,1)
  })
  await check('duplicate simultaneous mutation is rejected locally; library operations keep exact trip IDs',async()=>{
    const pending=defer(),calls=[],storage=store('owner')
    const client=createConversationClient(async(method,route,body)=>{
      calls.push({method,route,body})
      if(route==='/api/trips')return {trips:[{id:'A'},{id:'B'}]}
      if(route==='/api/trips/B/archive')return {}
      if(route==='/api/runs/B')return {stage:'completed',trip:{id:'B',provenance:'dsh'}}
      if(method==='DELETE')return {}
      if(method==='POST')return {id:'job'}
      return pending.promise
    },storage)
    const first=client.send('消息',()=>{},new PlanCancellation().signal)
    await assert.rejects(client.send('重复',()=>{},new PlanCancellation().signal),/当前请求/)
    assert.equal(calls.filter(c=>c.method==='POST').length,1)
    client.reset();await assert.rejects(first,/已取消/)
    assert.equal((await client.listTrips()).length,2);assert.equal((await client.loadTrip('B')).id,'B')
    await client.archiveTrip('B',true);assert.equal(calls.at(-1).route,'/api/trips/B/archive');assert.equal(calls.at(-1).body.archived,true)
  })
  await check('live presentation IDs use the source run for loading and persisted selection',async()=>{
    const storage=store('latest'),saved=[],runId='11111111-1111-4111-8111-111111111111',tripId='live-11111111-1111-4111-8111-111111111111'
    const owner=conversation('owner',tripId)
    const client=createConversationClient(async(method,route)=>{
      if(route==='/api/runs/'+runId)return {stage:'completed',trip:{id:tripId,provenance:'dsh'}}
      if(route==='/api/trips/'+tripId+'/context')return {conversation:owner,context:{conversationId:'owner',messageId:'anchor-'+tripId,runId,tripId}}
      assert.fail('Unexpected route '+route)
    },storage,id=>saved.push(id))
    assert.equal((await client.loadTrip(tripId)).id,tripId);await client.resumeTrip(tripId)
    assert.equal(saved[0],runId);assert.equal(storage.getTripContext().tripId,tripId)
  })
  await check('a newly generated itinerary becomes the adjustment target for the next turn',async()=>{
    const storage=store('owner'),sent=[],saved=[]
    const trip={id:'live-generation',provenance:'dsh'},owner={id:'owner',messages:[{id:'new-plan-anchor',role:'assistant',trip}]}
    const client=createConversationClient(async(method,route,body)=>{
      if(method==='POST'){sent.push(body);return {id:sent.length===1?'generation':'followup'}}
      return {stage:'completed',conversation:owner,...(sent.length===1?{trip}:{})}
    },storage,id=>saved.push(id))
    await client.send('生成新版本',()=>{},new PlanCancellation().signal,'plan')
    await client.send('把刚才的版本调整得轻松一点',()=>{},new PlanCancellation().signal)
    assert.equal(sent[1].tripContext.runId,'generation');assert.equal(sent[1].tripContext.messageId,'new-plan-anchor')
    assert.equal(storage.getTripContext().tripId,'live-generation');assert.deepEqual(saved,['generation'])
  })
  await check('overview cover is reused in its own library row and survives client reload without an image request',async()=>{
    const photo={src:'https://example.test/overview.jpg',description:'实际概览照片',author:'Author',license:'CC0',candidates:['https://example.test/small.jpg']}
    let savedCovers={},calls=[]
    const storage={...store('owner'),getTripCovers:()=>savedCovers,setTripCovers:value=>{savedCovers=value}}
    const transport=async(method,route)=>{
      calls.push({method,route})
      if(route==='/api/trips')return {trips:[{id:'A',cover:null},{id:'B',cover:null}]}
      if(route==='/api/runs/A')return {stage:'completed',trip:{id:'A',provenance:'dsh',cover:null}}
      assert.fail('must not fetch another image')
    }
    const client=createConversationClient(transport,storage);client.rememberTripCover('A',photo)
    let rows=await client.listTrips();assert.equal(rows[0].cover.src,photo.src);assert.equal(rows[1].cover,null)
    const reloaded=createConversationClient(transport,storage)
    rows=await reloaded.listTrips();assert.equal(rows[0].cover.author,'Author');assert.equal((await reloaded.loadTrip('A')).cover.src,photo.src)
    assert.ok(calls.every(call=>call.method==='GET'))
  })
  console.log('Session context regression: '+count+' passed.')
}
main().catch(error=>{console.error(error);process.exitCode=1})
