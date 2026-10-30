import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {dataRoot} from '../src/paths.mjs'
import {loadTripContext} from '../src/trip-context.mjs'
import {attachTrip} from '../src/conversation-timeline.mjs'
import {loadConversation, runConversation} from '../src/conversation.mjs'

async function fixture(work) {
  const root = await fs.mkdtemp(path.join(dataRoot, 'context-test-'))
  try { await fs.mkdir(path.join(root, 'runs')); await fs.mkdir(path.join(root, 'conversations')); await work(root) }
  finally { const target=path.resolve(root); assert.ok(target.startsWith(path.resolve(dataRoot)+path.sep)); await fs.rm(target,{recursive:true,force:true}) }
}
const save = (root, folder, id, value) => fs.writeFile(path.join(root,folder,id+'.json'),JSON.stringify(value))
test('old trip resolves its own conversation and message, independently of another newer conversation',()=>fixture(async root=>{
  const runId=crypto.randomUUID(), oldId=crypto.randomUUID(), newId=crypto.randomUUID()
  const trip={id:runId,provenance:'dsh',destination:'上海'}
  const old={id:oldId,timelineVersion:1,messages:[{id:'u1',role:'user',content:'上海与长辈旅行'},{id:'a1',role:'assistant',trip}]}
  const newer={id:newId,timelineVersion:1,messages:[{id:'u2',role:'user',content:'迪拜到多哈9位成人'}]}
  await save(root,'conversations',oldId,old); await save(root,'conversations',newId,newer)
  await save(root,'runs',runId,{id:runId,stage:'completed',trip,conversation:old})
  const result=await loadTripContext(runId,root)
  assert.equal(result.conversation.id,oldId); assert.deepEqual(result.context,{conversationId:oldId,messageId:'a1',runId,tripId:runId})
  assert.equal(result.conversation.messages[1].trip.context.conversationId,oldId)
  assert.deepEqual(await loadConversation(newId,root),newer)
}))
test('missing ownership, wrong trip, failed runs and foreign message anchors cannot restore another conversation',()=>fixture(async root=>{
  const id=crypto.randomUUID(), cid=crypto.randomUUID(), conversation={id:cid,timelineVersion:1,messages:[{id:'a',role:'assistant',trip:{id:'other'}}]}
  await save(root,'conversations',cid,conversation)
  for(const run of [{stage:'completed',trip:{id}}, {stage:'failed',trip:{id},conversation}, {stage:'completed',trip:{id:'other'},conversation}, {stage:'completed',trip:{id},conversation}]){
    await save(root,'runs',id,run); await assert.rejects(loadTripContext(id,root))
  }
  await assert.rejects(loadTripContext('../bad',root))
  await save(root,'conversations',cid,{...conversation,id:crypto.randomUUID()})
  await assert.rejects(loadConversation(cid,root),/不一致/)
}))
test('trip provenance records the exact owning message rather than the latest active conversation',()=>{
  const conversation={id:'owner',messages:[{id:'a',role:'assistant'},{id:'later',role:'assistant'}]},trip={id:'run'}
  attachTrip(conversation,trip,'a')
  assert.deepEqual(trip.context,{conversationId:'owner',messageId:'a',runId:'run',tripId:'run'})
  assert.equal(conversation.messages[1].trip,undefined)
})
test('new conversations and subsequent old-conversation turns keep their messages and tool evidence separate',()=>fixture(async root=>{
  const inputs=[]
  class Agent { async start(){} async close(){} async run(input){inputs.push(input);return {submission:{reply:'收到',intent:'chat'}}} }
  const a={id:crypto.randomUUID(),message:'只去上海，不能吃辣'}
  const b={id:crypto.randomUUID(),message:'迪拜到多哈九人，先查票'}
  await runConversation(a,{root,Agent}); await runConversation(b,{root,Agent})
  assert.notEqual(a.conversation.id,b.conversation.id)
  await runConversation({id:crypto.randomUUID(),message:'继续原上海计划',conversationId:a.conversation.id},{root,Agent})
  assert.ok(inputs[2].includes('不能吃辣')); assert.ok(!inputs[2].includes('迪拜到多哈'))
  assert.ok(!inputs[1].includes('不能吃辣'))
}))
test('adjustment identifies the exact itinerary in a conversation with multiple trips, and rejects foreign references before a model call',()=>fixture(async root=>{
  const cid=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID()
  const messages=[{id:'a',role:'assistant',content:'上海第一份',trip:{id:a,title:'上海长辈游',destination:'上海',dates:{start:'2026-11-01'},days:[]}},
    {id:'b',role:'assistant',content:'上海第二份',trip:{id:b,title:'上海朋友游',destination:'上海',dates:{start:'2026-12-01'},days:[]}}]
  await save(root,'conversations',cid,{id:cid,timelineVersion:1,messages})
  let input,calls=0
  class Agent{async start(){}async close(){}async run(value){calls++;input=value;return {submission:{reply:'调整长辈游',intent:'chat'}}}}
  const reference={conversationId:cid,messageId:'a',runId:a}
  const run={id:crypto.randomUUID(),conversationId:cid,message:'第一份少走一点',tripContext:reference}
  await runConversation(run,{root,Agent})
  assert.equal(run.constraints.activeTrip.id,a);assert.equal(run.constraints.activeTrip.dates.start,'2026-11-01')
  assert.match(input,/用户明确选择的调整对象/);assert.equal(run.conversation.messages.at(-2).tripContext.runId,a)
  for(const tripContext of [{...reference,conversationId:crypto.randomUUID()},{...reference,messageId:'b'},{...reference,runId:b}]){
    await assert.rejects(runConversation({id:crypto.randomUUID(),conversationId:cid,message:'wrong',tripContext},{root,Agent}))
  }
  assert.equal(calls,1)
}))
test('live-prefixed presentation identity resolves through its source run without losing the selected trip',()=>fixture(async root=>{
  const runId=crypto.randomUUID(),cid=crypto.randomUUID(),tripId='live-'+runId
  const trip={id:tripId,provenance:'dsh',destination:'上海'}
  const conversation={id:cid,timelineVersion:1,messages:[{id:'original',role:'assistant',trip}]}
  await save(root,'conversations',cid,conversation);await save(root,'runs',runId,{id:runId,stage:'completed',trip,conversation})
  const result=await loadTripContext(tripId,root)
  assert.equal(result.context.runId,runId);assert.equal(result.context.tripId,tripId)
  assert.equal((await loadTripContext(runId,root)).context.tripId,tripId)
}))
