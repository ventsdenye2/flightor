// Bounded diagnostic data must not retain credentials.
function clean(value, depth = 0) {
  if (depth > 5) return '[depth limited]'
  if (value == null) return null
  if (typeof value === 'string') return value.slice(0,1500)
    .replace(/https?:\/\/[^\s"<>]+/g, text => text.split('?')[0].replace(/\/\/[^/@]+@/,'//[redacted]@'))
    .replace(/Bearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/(?:eyJ[\w-]+\.){2}[\w-]+/g,'[redacted JWT]')
    .replace(/((?:key|token|secret|password|authorization)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]')
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0,15).map(v=>clean(v,depth+1))
  if (typeof value === 'object') {
    const result={}
    for (const key of Object.keys(value).slice(0,30)) {
      if (/key|token|secret|password|authorization|cookie|header|openid|unionid/i.test(key)) continue
      result[key]=clean(value[key],depth+1)
    }
    return result
  }
  return String(value).slice(0,100)
}
function diagnosticDetail(value) {
  const detail=value?.detail ?? value ?? null
  return {detail:clean(detail),errMsg:clean(detail?.errMsg??value?.message??null),errCode:clean(detail?.errCode??detail?.code??null)}
}
module.exports={diagnosticDetail}
