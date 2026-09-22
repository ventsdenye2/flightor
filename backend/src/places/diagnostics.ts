/** Persist only selected, bounded provider error fields; never request objects. */
export function placeFailureDetail(error: unknown) {
  const e=error as {name?:unknown;message?:unknown;code?:unknown;cause?:{code?:unknown}}
  const clean=(value:unknown)=>typeof value==='string'?value.slice(0,500)
    .replace(/https?:\/\/\S+/g,'[url omitted]')
    .replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/((?:key|token|secret|password|authorization)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]'):null
  return {name:clean(e?.name),errMsg:clean(e?.message),errCode:clean(e?.code),causeCode:clean(e?.cause?.code)}
}
