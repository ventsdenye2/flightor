// Execute the actual RoutePage hooks and async callbacks with deferred media reads.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript')
const source=ts.transpileModule(fs.readFileSync('src/pages/route/index.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
class ArtifactRequestSupersededError extends Error {}
const publicPlannerErrorModule={exports:{}}
const publicPlannerErrorSource=ts.transpileModule(fs.readFileSync('src/utils/publicPlannerError.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText
vm.runInNewContext(publicPlannerErrorSource,{module:publicPlannerErrorModule,exports:publicPlannerErrorModule.exports,require:name=>{assert.equal(name,'../services/artifactService');return{ArtifactRequestSupersededError}}})
const publicPlannerError=publicPlannerErrorModule.exports
function collect(node,type){if(!node)return[];if(Array.isArray(node))return node.flatMap(value=>collect(value,type));if(typeof node!=='object')return[];return[...(node.type===type?[node]:[]),...collect(node.props?.children,type)]}
async function scenario(change){
 const states=[],effects=[],cleanups=[],pending=[],requests=[];let cursor=0
 const userStore={profile:{uid:'owner-a'},sessionRevision:1},chatStore={currentSessionId:'session-a'},params={artifactId:'guide-a'}
 let artifactRead=async()=>artifact()
 const react={useState(v){const i=cursor++;if(!(i in states))states[i]=v;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]},useRef(v){const i=cursor++;if(!(i in states))states[i]={current:v};return states[i]},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((v,j)=>v!==effects[i][j])){effects[i]=deps;pending.push(()=>{cleanups[i]?.();cleanups[i]=fn()})}}}
 const artifact=()=>({id:params.artifactId,type:'travel_guide',tripId:params.artifactId})
 const load=async()=>({route:artifact(),presentation:{id:params.artifactId,locale:'zh',publication:{status:'accepted',artifactId:params.artifactId,contentVersion:'hash'},days:[],cover:null}})
 const service={loadProductionTrip:load,loadProductionPlaces:async x=>x,loadProductionMedia:x=>new Promise(resolve=>requests.push(()=>resolve({...x,presentation:{...x.presentation,cover:{src:'late-photo'}}}))),samePlacePublication:(a,b)=>a?.publication?.artifactId===b.publication.artifactId&&a?.publication?.contentVersion===b.publication.contentVersion,mergeProductionExtension:(a,b,kind)=>a.publication.artifactId===b.publication.artifactId&&a.publication.contentVersion===b.publication.contentVersion&&kind==='media'?{...a,cover:b.cover}:a}
 const module={exports:{}},jsx={jsx:(type,props)=>typeof type==='function'?type(props):({type,props}),jsxs:(type,props)=>typeof type==='function'?type(props):({type,props})}
 const taro={setNavigationBarTitle:async()=>{},navigateBack:async()=>{},switchTab:async()=>{},showToast:async()=>{}}
 vm.runInNewContext(source,{module,exports:module.exports,Map,Set,require:name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return jsx;if(name==='@tarojs/taro')return{default:taro,useRouter:()=>({params})}
  if(name==='mobx-react-lite')return{observer:f=>f};if(name.endsWith('/userStore'))return{userStore};if(name.endsWith('/chatStore'))return{chatStore}
  if(name.endsWith('/i18n'))return{localeStore:{locale:'zh'},t:k=>k};if(name.endsWith('/artifactService'))return{artifactService:{fetchArtifact:()=>artifactRead()}}
  if(name.endsWith('/publicPlannerError'))return publicPlannerError
  if(name.endsWith('/SharedUI'))return{EmptyState:props=>({type:'EmptyState',props}),PageHeader:props=>({type:'PageHeader',props})}
  if(name.endsWith('/productionTripService'))return service;if(name.endsWith('/registry'))return{resolveArtifactRenderer:()=>({supported:true,key:'travel_guide'})}
  if(name==='../../features/ui-experience/productionPresentation')return{safeSourceUrl:x=>x}
  if(name==='./dispatch')return{decodeRouteParam:x=>x,resolveRouteDetailView:input=>input.error?{kind:'error',message:input.error}:input.presentation?{kind:'trip',presentation:input.presentation}:{kind:'loading'}}
  return{}
 }})
 const render=()=>{cursor=0;const tree=module.exports.default();while(pending.length)pending.shift()();return tree}
 const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()}
 if(change==='superseded'||change==='read-error'){
  artifactRead=async()=>{throw change==='superseded'?new ArtifactRequestSupersededError('internal stale response'):new Error('HTTP body bearer-secret stack=private')}
  render();await flush();const tree=render()
  const state=states[0],empty=collect(tree,'EmptyState')[0]
  assert.equal(state.error,'本次请求状态暂时无法恢复。请重新打开行程并检查已保存结果，再决定是否重试。')
  assert.ok(!state.error.includes('bearer-secret'))
  assert.equal(empty?.props.description,state.error)
  assert.equal(empty?.props.actionLabel,'trip.refresh')
  assert.equal(typeof empty?.props.onAction,'function','restore error keeps the existing refresh action')
  return
 }
 render();await flush();assert.equal(requests.length,1)
 if(change==='owner'){userStore.profile.uid='owner-b';userStore.sessionRevision++}
 if(change==='session'){chatStore.currentSessionId='session-b'}
 if(change==='trip'){params.artifactId='guide-b'}
 if(change==='generation'){states[1]++} // actual page refresh attempt state
 if(change==='content'){states[0]={...states[0],presentation:{...states[0].presentation,publication:{...states[0].presentation.publication,contentVersion:'new'}}}}
 else {render();await flush()}
 requests[0]();await flush();assert.equal(states[0].presentation.cover,null,`${change}: stale media was applied`)
}
;(async()=>{for(const value of ['owner','session','trip','generation','content'])await scenario(value);await scenario('superseded');await scenario('read-error');console.log('PASS actual RoutePage rejects delayed media after owner, session, trip, request generation and content version changes; superseded and failed reads show actionable safe restore state')})().catch(e=>{console.error(e);process.exitCode=1})
