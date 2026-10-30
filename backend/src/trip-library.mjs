import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {dataRoot} from './paths.mjs'
import {replaceFile} from './file-replace.mjs'
import {tripRunId,isSavedTrip} from './trip-identity.mjs'
import {storedTripCover} from './trip-cover.mjs'

async function savedRun(id,root) {
  const runId=tripRunId(id)
  const run=JSON.parse(await fs.readFile(path.join(root,'runs',runId+'.json'),'utf8'))
  if(!isSavedTrip(run,runId))throw Error('行程不存在')
  return run
}
async function flags(id,root) {
  try{return JSON.parse(await fs.readFile(path.join(root,'trip-library',id+'.json'),'utf8'))}
  catch(error){if(error.code==='ENOENT')return {archived:false};throw error}
}
export async function listTrips(root=dataRoot) {
  let files
  try{files=await fs.readdir(path.join(root,'runs'))}catch(error){if(error.code==='ENOENT')return [];throw error}
  const rows=[]
  // Bounded reads: existing saved runs remain the authoritative trip catalogue.
  const ids=files.filter(name=>/^[a-f\d-]{36}\.json$/i.test(name)).map(name=>name.slice(0,-5))
  for(let offset=0;offset<ids.length;offset+=12) {
    const batch=await Promise.all(ids.slice(offset,offset+12).map(async id=>{
      let run
      try{run=await savedRun(id,root)}catch{return null}
      const trip=run.trip,state=await flags(id,root),cover=await storedTripCover(trip)
      return {id:trip.id,title:trip.title,destination:trip.destination,dates:trip.dates,durationDays:trip.durationDays,travelers:trip.travelers,route:trip.route,cover,status:trip.status,createdAt:run.createdAt||null,completedAt:run.completedAt||run.createdAt||null,archived:state.archived===true,contextAvailable:!!run.conversation?.id}
    }))
    rows.push(...batch.filter(Boolean))
  }
  return rows.sort((a,b)=>String(b.completedAt).localeCompare(String(a.completedAt))||a.id.localeCompare(b.id))
}
export async function archiveTrip(id,archived,root=dataRoot) {
  if(typeof archived!=='boolean')throw Error('无效的归档状态')
  const run=await savedRun(id,root)
  const dir=path.join(root,'trip-library');await fs.mkdir(dir,{recursive:true})
  const file=path.join(dir,run.id+'.json'),temp=file+'.'+crypto.randomUUID()+'.tmp'
  await fs.writeFile(temp,JSON.stringify({archived,updatedAt:new Date().toISOString()}))
  await replaceFile(temp,file)
  return {id:run.trip.id,archived}
}
