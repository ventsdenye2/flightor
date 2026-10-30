export function tripRunId(id) {
  if(typeof id!=='string'||!/^(?:live-)?[a-f\d-]{36}$/i.test(id))throw Error('无效的行程ID')
  return id.startsWith('live-')?id.slice(5):id
}
export function isSavedTrip(run,runId) {
  return run.id===runId&&run.stage==='completed'&&run.trip?.provenance==='dsh'&&(run.trip.id===runId||run.trip.id==='live-'+runId)
}
