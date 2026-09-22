const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm'),ts=require('typescript')
function load(file,require){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require,URL,Map});return module.exports}
const service=load('src/services/productionTripService.ts',()=>({}))
const base={id:'trip',locale:'zh',publication:{status:'accepted',artifactId:'g',contentVersion:'hash'},days:[{id:1,activities:[{id:'a',name:'Name',place:{status:'resolved'},latitude:1,longitude:2,media:null}]}],mapCities:[{id:'c'}],flightPaths:[[]],cover:null}
const photo={src:'https://upload.wikimedia.org/photo.jpg',description:'Name'}
const media={...base,cover:photo,days:[{id:1,activities:[{id:'a',media:photo}]}],mapCities:[]}
const places={...base,days:[{id:1,activities:[{id:'a',place:{status:'resolved',placeId:'new'},latitude:3,longitude:4,media:null}]}]}
for(const [first,last,one,two] of [[media,places,'media','places'],[places,media,'places','media']]){
 const r=service.mergeProductionExtension(service.mergeProductionExtension(base,first,one),last,two)
 assert.equal(r.days[0].activities[0].media.src,photo.src);assert.equal(r.days[0].activities[0].place.placeId,'new');assert.equal(r.cover.src,photo.src)
}
for(const changed of [{...media,locale:'en'},{...media,publication:{...media.publication,contentVersion:'new'}},{...media,publication:{...media.publication,artifactId:'other'}}])assert.equal(service.mergeProductionExtension(base,changed,'media'),base)
let states=[],cursor=0,effects=[],pending=[]
const react={useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}]},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((d,j)=>d!==effects[i][j])){effects[i]=deps;pending.push(fn)}}}
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'Fragment'}
const comp=load('src/features/ui-experience/PublishedTripExperience.tsx',name=>name==='react'?react:name==='react/jsx-runtime'?jsx:name.includes('@tarojs/components')?{Button:'Button',Text:'Text',View:'View'}:name.endsWith('/i18n')?{localeStore:{setLocale(){}}}:name.endsWith('/i18n/trip')?{tripText:(_l,k)=>k}:name.endsWith('/DayPlan')?{DayPlan:'DayPlan'}:name.endsWith('/FlightTicket')?{FlightTicket:'FlightTicket'}:name.endsWith('/VisualMedia')?{Photo:'Photo',Icon:'Icon'}:{default:'TripMap'})
const trip={...base,route:['Tokyo'],dates:{},days:[{id:1,activities:[{...base.days[0].activities[0],media:null}]},{id:2,activities:[{id:'b',name:'Second',media:null}]}],flights:[],sources:[],publication:{...base.publication,issues:[]}}
function render(t){cursor=0;pending=[];const tree=comp.default({trip:t});pending.forEach(fn=>fn());return tree}
function nodes(root){return root&&typeof root==='object'?[root,...(Array.isArray(root.props?.children)?root.props.children.flat(Infinity):[root.props?.children]).flatMap(nodes)]:[]}
render(trip);states[0]='days';states[1]=1;states[2]=trip.days[1].activities[0]
const updated={...trip,days:trip.days.map(d=>({...d,activities:d.activities.map(a=>({...a,media:photo}))}))}
const tree=render(updated)
assert.equal(states[1],1);assert.equal(states[2].id,'b');assert.ok(nodes(tree).some(n=>n.type==='Photo'&&n.props.className==='ux-detail-photo'))
render({...updated,publication:{...updated.publication,contentVersion:'new'}});assert.equal(states[1],0);assert.equal(states[2],null)
console.log('PASS media/place merge in either completion order; old hash/artifact/locale ignored; media arrival retains day and open activity and updates its photo; new content resets selection')
