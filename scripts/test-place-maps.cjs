const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript')
function load(file,require){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require,setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout:()=>{}},{filename:file});return module.exports}
const timers=[],calls=[],selected=[],states=[]
const coordinates=load('src/features/maps/coordinates.ts',()=>{})
const C=load('src/features/maps/TripMap.tsx',name=>{
 if(name==='react')return{createElement:(type,props)=>({type,props}),useState:()=>[false,v=>states.push(v)],useRef:v=>({current:v}),useEffect:fn=>fn()}
 if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}
 if(name==='@tarojs/components')return{Map:'Map',Text:'Text',View:'View'}
 if(name==='@tarojs/taro')return{__esModule:true,default:{nextTick:fn=>fn(),createMapContext:id=>({addMarkers:value=>calls.push({id,...value})})}}
 if(name==='./coordinates')return coordinates
 if(name.includes('i18n'))return{tripText:(_locale,key)=>key}
 if(name.endsWith('.scss'))return{}
 throw Error(name)
}).default
const points=[{id:'a',name:'第一处',latitude:35.67,longitude:139.69,countryCode:'JP',number:2},{id:'b',name:'Second place',latitude:35.71,longitude:139.77,countryCode:'JP',number:4}]
const tree=C({points,selectedId:'b',onSelect:id=>selected.push(id),locale:'en',mapKey:'day-2',orderLine:true}),map=tree.props.children[0]
assert.equal(map.type,'place-map');const payload=JSON.parse(map.props.payload)
assert.deepEqual(payload.markers.map(m=>m.label.content),['2','4'])
map.props.onSelectplace({detail:{markerId:2}});assert.deepEqual(selected,['b'])
assert.equal(payload.markers[1].width,40);assert.equal(payload.markers[0].latitude,35.67)
assert.equal(payload.lines[0].dottedLine,true)
map.props.onMapready()
timers[0]();assert.equal(states.at(-1),false)
tree.props.children.at(-1).props.onClick();assert.equal(states.at(-1),true,'silent basemap failure has a compact user fallback')
C({points,locale:'en',mapKey:'never-ready'});timers.at(-1)();assert.equal(states.at(-1),true)
let native
const viewport=[]
vm.runInNewContext(fs.readFileSync('src/components/place-map/index.js','utf8'),{Component:value=>{native=value},wx:{createMapContext:()=>({includePoints:value=>viewport.push(value)})}})
const events=[],data={};const instance={setData:value=>Object.assign(data,value),triggerEvent:(...value)=>events.push(value)}
native.methods.updatePoints.call(instance,map.props.payload)
assert.deepEqual(Array.from(data.markers,m=>m.label.content),['2','4'])
native.methods.selectMarker.call(instance,{detail:{markerId:2}});assert.equal(events[0][0],'selectplace')
assert.equal(events[0][1].markerId,2)
const ready={data,triggerEvent:instance.triggerEvent,fitBounds:native.methods.fitBounds}
native.lifetimes.ready.call(ready);assert.equal(viewport.length,1);assert.equal(viewport[0].points.length,2)
ready.fitBounds();assert.equal(viewport.length,1,'fitting bounds must not loop on map updates')
native.methods.updatePoints.call(instance,'broken');assert.equal(events.at(-1)[0],'mapfailure')
assert.ok(fs.readFileSync('src/components/place-map/index.wxml','utf8').includes('show-location="{{false}}"'))
console.log('PASS native array transport, stable IDs, gap numbering, selection, Japan coordinates, no user location and render-timeout fallback')
