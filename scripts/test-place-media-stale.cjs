// Execute the actual RoutePage hooks and async callbacks with deferred media reads.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript')
const source=ts.transpileModule(fs.readFileSync('src/pages/route/index.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
async function scenario(change){
 const states=[],effects=[],cleanups=[],pending=[],requests=[];let cursor=0
 const userStore={profile:{uid:'owner-a'},sessionRevision:1},chatStore={currentSessionId:'session-a'},params={artifactId:'guide-a'}
 const react={useState(v){const i=cursor++;if(!(i in states))states[i]=v;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=cursor++;if(!(i in states))states[i]={current:v};return states[i]},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((v,j)=>v!==effects[i][j])){effects[i]=deps;pending.push(()=>{cleanups[i]?.();cleanups[i]=fn()})}}}
 const artifact=()=>({id:params.artifactId,type:'travel_guide',tripId:params.artifactId})
 const load=async()=>({route:artifact(),presentation:{id:params.artifactId,locale:'zh',publication:{status:'accepted',artifactId:params.artifactId,contentVersion:'hash'},days:[],cover:null}})
 const service={loadProductionTrip:load,loadProductionPlaces:async x=>x,loadProductionMedia:x=>new Promise(resolve=>requests.push(()=>resolve({...x,presentation:{...x.presentation,cover:{src:'late-photo'}}}))),samePlacePublication:(a,b)=>a?.publication?.artifactId===b.publication.artifactId&&a?.publication?.contentVersion===b.publication.contentVersion,mergeProductionExtension:(a,b,kind)=>a.publication.artifactId===b.publication.artifactId&&a.publication.contentVersion===b.publication.contentVersion&&kind==='media'?{...a,cover:b.cover}:a}
 const module={exports:{}},jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}
 const taro={setNavigationBarTitle:async()=>{},navigateBack:async()=>{},switchTab:async()=>{},showToast:async()=>{}}
 vm.runInNewContext(source,{module,exports:module.exports,Map,Set,require:name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;if(name==='@tarojs/taro')return{default:taro,useRouter:()=>({params})}
  if(name==='mobx-react-lite')return{observer:f=>f};if(name.endsWith('/userStore'))return{userStore};if(name.endsWith('/chatStore'))return{chatStore}
  if(name.endsWith('/i18n'))return{localeStore:{locale:'zh'},t:k=>k};if(name.endsWith('/artifactService'))return{artifactService:{fetchArtifact:async()=>artifact()}}
  if(name.endsWith('/productionTripService'))return service;if(name.endsWith('/registry'))return{resolveArtifactRenderer:()=>({supported:true,key:'travel_guide'})}
  if(name==='./dispatch')return{decodeRouteParam:x=>x,resolveRouteDetailView:()=>({kind:'loading'})}
  return{}
 }})
 const render=()=>{cursor=0;module.exports.default();while(pending.length)pending.shift()()}
 const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()}
 render();await flush();assert.equal(requests.length,1)
 if(change==='owner'){userStore.profile.uid='owner-b';userStore.sessionRevision++}
 if(change==='session'){chatStore.currentSessionId='session-b'}
 if(change==='trip'){params.artifactId='guide-b'}
 if(change==='generation'){states[1]++} // actual page refresh attempt state
 if(change==='content'){states[0]={...states[0],presentation:{...states[0].presentation,publication:{...states[0].presentation.publication,contentVersion:'new'}}}}
 else {render();await flush()}
 requests[0]();await flush();assert.equal(states[0].presentation.cover,null,`${change}: stale media was applied`)
}
;(async()=>{for(const value of ['owner','session','trip','generation','content'])await scenario(value);console.log('PASS actual RoutePage rejects delayed media after owner, session, trip, request generation and content version changes')})().catch(e=>{console.error(e);process.exitCode=1})
