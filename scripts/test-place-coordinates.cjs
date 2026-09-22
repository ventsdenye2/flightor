const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict')
const moduleValue={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/features/maps/coordinates.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:moduleValue.exports,Math})
const {displayPoint}=moduleValue.exports
for(const p of [{countryCode:'JP',latitude:35.71,longitude:139.77},{countryCode:'KR',latitude:37.56,longitude:126.97}]){
 const shown=displayPoint({...p,id:'poi',name:'Place'},'GCJ02');assert.equal(shown.latitude,p.latitude);assert.equal(shown.longitude,p.longitude);assert.equal(shown.converted,false)
}
const input={id:'beijing',name:'Park',countryCode:'CN',latitude:39.9,longitude:116.4},out=displayPoint(input,'GCJ02')
assert.ok(out.converted&&Math.abs(out.longitude-input.longitude)>.001);assert.equal(input.longitude,116.4)
assert.equal(displayPoint(input,'WGS84').longitude,input.longitude)
console.log('PASS WGS84 preserved; mainland-only display conversion; Japan/Korea unshifted; immutable input')
