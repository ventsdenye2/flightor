const fs=require('fs'),vm=require('vm'),assert=require('assert/strict')
let definition;const fits=[],events=[],timers=[]
vm.runInNewContext(fs.readFileSync('src/components/place-map/index.js','utf8'),{
 require:()=>require('../src/components/place-map/diagnostic-detail'),
 Component:d=>{definition=d},wx:{createMapContext:()=>({includePoints:p=>fits.push(p)})},
 setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout:()=>{}
})
const component={data:{latitude:35.67,longitude:139.69,scale:13,bounds:[{latitude:35.67,longitude:139.69}],markers:[]},
 setData(value,done){Object.assign(this.data,value);done?.()},triggerEvent(name,detail){events.push({name,detail})},...definition.methods}
definition.lifetimes.ready.call(component)
fits[0].fail({errMsg:'includePoints:fail test',errCode:123})
assert.equal(events.filter(e=>e.name==='mapfailure').length,0,'viewport failure must not hide the map')
assert.notEqual(component.boundsSignature,JSON.stringify(component.data.bounds),'failed bounds are not successful')
assert.equal(component.data.latitude,35.67)
assert.equal(component.data.scale,13)
timers.splice(0).forEach(fn=>fn())
assert.equal(fits.length,2,'one bounded retry')
fits[1].fail({errMsg:'includePoints:fail again'})
fits[0].success({errMsg:'late success'})
assert.equal(component.boundsSignature,undefined,'late callback must not certify failed bounds')
timers.splice(0).forEach(fn=>fn());assert.equal(fits.length,2)
assert.ok(events.some(e=>e.name==='mapdiagnostic'&&e.detail.detail?.errCode===123),'retain actual native detail')
component.mapReady({detail:{type:'updated'}})
assert.ok(events.some(e=>e.detail?.stage==='updated'&&e.detail.basemap==='unknown'))
const {diagnosticDetail}=require('../src/components/place-map/diagnostic-detail')
const sanitized=diagnosticDetail({detail:{errMsg:'failed https://example.com/tile?key=private',errCode:42,token:'private',authorization:'Bearer private'}})
assert.equal(sanitized.errCode,42);assert.ok(!JSON.stringify(sanitized).includes('private'))
assert.equal(diagnosticDetail(null).errMsg,null);assert.equal(diagnosticDetail(null).errCode,null)
console.log('PASS viewport failure stays visible, bounded retry, actual native details, updated not basemap success')
