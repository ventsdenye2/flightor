import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {dataRoot} from '../src/paths.mjs'
import {listTrips,archiveTrip} from '../src/trip-library.mjs'

async function fixture(work){
  const root=await fs.mkdtemp(path.join(dataRoot,'trip-library-test-'))
  try{await fs.mkdir(path.join(root,'runs'));await work(root)}
  finally{const target=path.resolve(root);assert.ok(target.startsWith(path.resolve(dataRoot)+path.sep));await fs.rm(target,{recursive:true,force:true})}
}
const save=(root,id,value)=>fs.writeFile(path.join(root,'runs',id+'.json'),JSON.stringify(value))
const run=(id,title,date)=>({id,stage:'completed',createdAt:date,completedAt:date,trip:{id,provenance:'dsh',title,destination:title,days:[{activities:[]}],dates:{start:'2026-11-01',end:'2026-11-04'},route:['北京',title],status:'ready'},conversation:{id:crypto.randomUUID()}})
test('list retains multiple historical trips ordered by completion, without sample, manual or incomplete runs',()=>fixture(async root=>{
  const first=crypto.randomUUID(),second=crypto.randomUUID()
  await save(root,first,run(first,'上海','2026-10-25T01:00:00Z'));await save(root,second,run(second,'东京','2026-10-26T01:00:00Z'))
  for(const patch of [{stage:'failed'},{stage:'searching'},{trip:null},{trip:{id:'foreign',provenance:'dsh'}},{trip:{provenance:'sample'}}]){const id=crypto.randomUUID();await save(root,id,{...run(id,'invalid','2026-10-26'),...patch})}
  const rows=await listTrips(root)
  assert.deepEqual(rows.map(row=>row.id),[second,first]);assert.equal(rows[0].days,undefined);assert.equal(rows[0].archived,false)
  assert.equal(rows[0].contextAvailable,true);assert.deepEqual((await listTrips(root)).map(row=>row.id),[second,first])
}))
test('archive and restore persist per trip without deleting another trip or mutating saved generation',()=>fixture(async root=>{
  const a=crypto.randomUUID(),b=crypto.randomUUID(),original=run(a,'上海','2026-10-25')
  await save(root,a,original);await save(root,b,run(b,'东京','2026-10-26'))
  await archiveTrip(a,true,root)
  let rows=await listTrips(root)
  assert.equal(rows.find(row=>row.id===a).archived,true);assert.equal(rows.find(row=>row.id===b).archived,false)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'runs',a+'.json'),'utf8')),original)
  await archiveTrip(a,false,root);rows=await listTrips(root);assert.ok(rows.every(row=>!row.archived));assert.equal(rows.length,2)
}))
test('empty library and invalid archive targets do not invent trips',()=>fixture(async root=>{
  assert.deepEqual(await listTrips(root),[])
  await assert.rejects(archiveTrip('../bad',true,root));await assert.rejects(archiveTrip(crypto.randomUUID(),true,root))
  await assert.rejects(archiveTrip(crypto.randomUUID(),'true',root))
}))
test('real live-prefixed trip identities remain in the catalogue and archive by the source run',()=>fixture(async root=>{
  const id=crypto.randomUUID(),value=run(id,'真实上海','2026-10-26');value.trip.id='live-'+id
  await save(root,id,value)
  assert.equal((await listTrips(root))[0].id,'live-'+id)
  await archiveTrip('live-'+id,true,root);assert.equal((await listTrips(root))[0].archived,true)
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'trip-library',id+'.json'),'utf8')).archived,true)
}))
test('catalogue uses the same first available itinerary photo as overview, retaining attribution and fallback URLs',()=>fixture(async root=>{
  const id=crypto.randomUUID(),value=run(id,'里约','2026-10-27')
  const photo={src:'https://example.test/copacabana.jpg',description:'科帕卡巴纳',author:'Photographer',license:'CC BY-SA 4.0',source:{url:'https://example.test/source'},candidates:['https://example.test/small.jpg']}
  value.trip.cover={src:null,description:'图片待补充'}
  value.trip.days=[{activities:[{media:null},{media:photo},{media:{src:'https://example.test/other.jpg'}}]}]
  await save(root,id,value)
  assert.deepEqual((await listTrips(root))[0].cover,photo)
  const cover={...photo,src:'https://example.test/explicit.jpg'};value.trip.cover=cover
  await save(root,id,value);assert.deepEqual((await listTrips(root))[0].cover,cover)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'runs',id+'.json'),'utf8')),value)
}))
