import { readFileSync,writeFileSync,mkdirSync,readdirSync,copyFileSync,existsSync,symlinkSync,openSync,closeSync,unlinkSync } from 'node:fs';
import { resolve,dirname,join,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Budget,validCost } from './budget.mjs';
import { catalog,complete,webBody,safeError } from './openrouter.mjs';
import { schemaForCase,researchMessages,citationSources,parseResearch } from './contracts.mjs';
import { normalizeCurrentArtifact } from './projection.mjs';
import { writeReport } from './report.mjs';
import { classifyResponse, assertCompatibleManifest } from './run-controls.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../../..');
const args=process.argv.slice(2);
const command=args[0] ?? 'plan';
const flag=name=>{const i=args.indexOf(`--${name}`);return i<0?undefined:args[i+1];};
const list=(name,defaults)=>flag(name)?.split(',') ?? defaults;
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const save=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cases=json(join(here,'cases.json'));
const models=json(join(here,'models.json'));
const arms=['direct-web','thin-web','current-system'];

function select(items,ids,key='id') {
  const selected=items.filter(x=>ids.includes(x[key]));
  if (selected.length !== new Set(ids).size) throw new Error(`UNKNOWN_SELECTION: ${ids.join(',')}`);
  return selected;
}

// Freeze current source bytes, including uncommitted files, without copying credentials or build artifacts.
function snapshotBaseline(output, baselineRoot) {
  const target=join(output,'baseline'); const files=[];
  function copyTree(source,dest) {
    mkdirSync(dest,{recursive:true});
    for (const entry of readdirSync(source,{withFileTypes:true})) {
      if (entry.name.startsWith('._')) continue;
      const src=join(source,entry.name),dst=join(dest,entry.name);
      if(entry.isDirectory())copyTree(src,dst);
      else if(entry.isFile()) {copyFileSync(src,dst);files.push({path:relative(baselineRoot,src).replaceAll('\\','/'),sha256:hash(readFileSync(dst))});}
    }
  }
  copyTree(join(baselineRoot,'backend/src'),join(target,'backend/src'));
  for (const name of ['package.json','package-lock.json','tsconfig.json']) {
    const src=join(baselineRoot,'backend',name);
    if(existsSync(src)){copyFileSync(src,join(target,'backend',name));files.push({path:`backend/${name}`,sha256:hash(readFileSync(src))});}
  }
  symlinkSync(join(baselineRoot,'backend/node_modules'),join(target,'backend/node_modules'),'junction');
  const git=(...a)=>execFileSync('git',a,{cwd:baselineRoot,encoding:'utf8'}).trim();
  const manifest={root:baselineRoot,head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),
    backendStatus:git('status','--short','--','backend/src','backend/package.json','backend/package-lock.json'),
    files:files.sort((a,b)=>a.path.localeCompare(b.path)),dependencies:'shared installed backend/node_modules; package-lock hashed'};
  manifest.sourceHash=hash(JSON.stringify(manifest.files));
  save(join(output,'baseline-manifest.json'),manifest);
  return {target,manifest};
}

async function main() {
  const selectedCases=select(cases,list('cases',cases.map(x=>x.id)));
  const selectedModels=select(models,list('models',models.map(x=>x.id)));
  const selectedArms=command==='probe'?['probe']:list('arms',arms);
  if(selectedArms.some(x=>!arms.includes(x)&&x!=='probe'))throw new Error('UNKNOWN_ARM');
  const repeats=Number(flag('repeats')??1),limit=Number(flag('budget-usd')??5);
  const concurrency=Number(flag('concurrency')??1),design=flag('design')??'full';
  if(![1,2].includes(concurrency)||!['full','research-screen'].includes(design))throw new Error('INVALID_DESIGN');
  const baselineModel='deepseek/deepseek-v4-flash-0731';
  const maxSearches=Number(flag('max-searches')??96), engineMode=flag('engine')??'exa';
  if(!Number.isInteger(repeats)||repeats<1||repeats>10)throw new Error('INVALID_REPEATS');
  if(!['exa','preferred'].includes(engineMode))throw new Error('INVALID_ENGINE');
  const plan={protocol:'research-v4-audited-controls',scope:command==='probe'?'model API availability only':'research-component; no Planner, flight fares, persistence, UI or recovery E2E',
    cases:selectedCases.map(x=>x.id),models:selectedModels,arms:selectedArms,repeats,engineMode,concurrency,design,baselineModel,
    cells:selectedCases.length*selectedModels.reduce((n,m)=>n+selectedArms.filter(a=>design==='full'||a==='thin-web'||m.id===baselineModel).length,0)*repeats,
    budgetUsd:limit,maxSerpApiSearches:maxSearches,timeoutMs:95000,seed:20260913};
  if(command==='plan'){console.log(JSON.stringify(plan,null,2));return;}
  const liveModels=await catalog();
  const infos=selectedModels.map(model=>{
    const info=liveModels.find(x=>x.id===model.id);if(!info)throw new Error(`MODEL_UNAVAILABLE: ${model.id}`);
    return {id:info.id,created:info.created,pricing:info.pricing,supported_parameters:info.supported_parameters};
  });
  if(command==='preflight'){
    const out=resolve(flag('out')??join(here,'.runs','preflight'));mkdirSync(out,{recursive:true});
    const data={checkedAt:new Date().toISOString(),plan,models:infos,
      configured:{openrouter:Boolean(process.env.OPENROUTER_API_KEY),serpapi:Boolean(process.env.SERPAPI_API_KEY||process.env.SERPAPI_KEY)}};
    save(join(out,'preflight.json'),data);console.log(JSON.stringify(data,null,2));return;
  }
  if(!['run','probe'].includes(command))throw new Error('Use plan, preflight, probe or run');
  if(!args.includes('--live'))throw new Error('LIVE_FLAG_REQUIRED');
  if(!process.env.OPENROUTER_API_KEY)throw new Error('OPENROUTER_NOT_CONFIGURED');
  if(selectedArms.includes('current-system')&&!process.env.SERPAPI_API_KEY&&!process.env.SERPAPI_KEY)throw new Error('SERPAPI_NOT_CONFIGURED');
  const output=resolve(flag('out')??join(here,'.runs',new Date().toISOString().replaceAll(':','-')));
  // Exclusive run directory prevents overwrites and accidental duplicate billing through resume.
  mkdirSync(dirname(output),{recursive:true});mkdirSync(output,{recursive:false});
  const baselineRoot=resolve(flag('baseline')??root);
  const baseline=selectedArms.includes('current-system')?snapshotBaseline(output,baselineRoot):null;
  const startedAt=new Date().toISOString();
  const manifest={startedAt,plan,models:infos,casesHash:hash(readFileSync(join(here,'cases.json'))),
    modelsHash:hash(readFileSync(join(here,'models.json'))),baselineHash:baseline?.manifest.sourceHash??null,
    runnerFiles:readdirSync(here).filter(n=>/\.(mjs|json)$/.test(n)).sort().map(n=>({path:n,sha256:hash(readFileSync(join(here,n)))}))};
  save(join(output,'manifest.json'),manifest);
  const ledgerPath=resolve(flag('ledger')??join(here,'.runs','budget-ledger.json'));
  const ledgerLock=ledgerPath+'.lock';
  const budget=new Budget(limit,0.25,maxSearches),rows=[];
  const lock=openSync(ledgerLock,'wx');
  try {
  if(existsSync(ledgerPath))budget.restore(json(ledgerPath));
  const persistBudget=()=>save(ledgerPath,budget.snapshot());
  const originalReserve=budget.reserve.bind(budget),originalSettle=budget.settle.bind(budget),originalSearch=budget.reserveSearch.bind(budget);
  budget.reserve=()=>{const id=originalReserve();persistBudget();return id;};
  budget.settle=(...args)=>{originalSettle(...args);persistBudget();};
  budget.reserveSearch=()=>{originalSearch();persistBudget();};
  // A crash leaves held reservations and the lock for explicit inspection; never auto-replay paid requests.
  let jobs=[];
  for(let repetition=0;repetition<repeats;repetition++)for(const testCase of selectedCases)for(const model of selectedModels)for(const arm of selectedArms) {
    if(design==='research-screen'&&arm!=='thin-web'&&model.id!==baselineModel)continue;
    jobs.push({testCase,model,arm,repetition});
  }
  // Deterministic interleaving; optional two workers are recorded in the manifest.
  let seed=20260913;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let i=jobs.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[jobs[i],jobs[j]]=[jobs[j],jobs[i]];}
  const priorRuns=list('skip-runs',[]);
  const jobKey=x=>[x.caseId??x.testCase?.id,typeof x.model==='string'?x.model:x.model.id,x.arm,x.repetition].join('|');
  const priorKeys=new Set();
  for(const previous of priorRuns){
    const previousManifest=json(join(resolve(previous),'manifest.json'));
    assertCompatibleManifest(previousManifest,manifest);
    for(const file of readdirSync(resolve(previous)).filter(n=>/^sample-\d+\.json$/.test(n)))priorKeys.add(jobKey(json(join(resolve(previous),file))));
  }
  jobs=jobs.filter(job=>!priorKeys.has(jobKey(job)));
  save(join(output,'previous-runs.json'),{priorRuns,priorCells:priorKeys.size,remainingCells:jobs.length});
  save(join(output,'schedule.json'),jobs.map(({testCase,model,arm,repetition})=>({caseId:testCase.id,model:model.id,arm,repetition})));
  let nextJob=0;
  const worker=async()=>{
  while(nextJob<jobs.length) {
    const index=nextJob++,job=jobs[index];
    const {testCase,model,arm,repetition}=job;
    if(budget.unknownCalls>budget.reviewedRejections||budget.knownUsd+budget.heldUsd+budget.reservationUsd>limit) {console.log('Budget admission stopped; remaining cells unrun.');break;}
    const start=performance.now(),trace=[];
    const row={id:`sample-${String(index+1).padStart(3,'0')}`,caseId:testCase.id,model:model.id,arm,repetition,
      engine:arm==='current-system'?'serpapi':engineMode==='preferred'?model.preferredEngine:'exa',trace,startedAt:new Date().toISOString()};
    const signal=AbortSignal.timeout(95000);
    try {
      if(arm==='probe') {
        const response=await complete({body:{model:model.id,messages:[{role:'user',content:'Return exactly OK.'}],max_tokens:128,
          reasoning:model.reasoning??{enabled:false,exclude:true},provider:{allow_fallbacks:false}},signal,budget,trace,timeoutMs:30000});
        row.content=response.message.content;row.status=row.content.trim()==='OK'?'responded':'unexpected_probe_output';
      } else if(arm==='current-system') {
        const {runCurrentSystem}=await import('./current-system.mjs');
        const result=await runCurrentSystem({baselineRoot:baseline.target,testCase,model:model.id,signal,
          onSearch:()=>budget.reserveSearch(),
          complete:async({messages,model:requested,options})=>{
            const body={model:requested,messages,max_tokens:options.maxTokens,
              ...(options.temperature===undefined?{}:{temperature:options.temperature}),reasoning:model.reasoning??options.reasoning,
              response_format:options.responseFormat,provider:{require_parameters:true,allow_fallbacks:true}};
            const info=infos.find(x=>x.id===requested);
            if(!info.supported_parameters.includes('temperature'))delete body.temperature;
            if(!info.supported_parameters.includes('reasoning'))delete body.reasoning;
            const response=await complete({body,signal,budget,trace,timeoutMs:options.timeoutMs});
            return {message:response.message,finishReason:response.finishReason};
          }});
        row.currentSystem=result;
        row.result=normalizeCurrentArtifact(result.artifact,testCase);
        row.status=trace.some(t=>t.error)||result.artifact.warnings.length?'partial':'responded';
      } else {
        const structured=arm==='thin-web';
        const body=webBody({model,modelInfo:infos.find(x=>x.id===model.id),messages:researchMessages(testCase,structured,startedAt),
          structured,schema:schemaForCase(testCase),engine:row.engine});
        const response=await complete({body,signal,budget,trace});
        row.citations=citationSources(response.message);row.content=response.message.content;
        row.result=structured?parseResearch(row.content,testCase,row.citations):null;
        Object.assign(row,classifyResponse(response,structured,row.result));
      }
    } catch(error) {row.status=signal.aborted?'timeout':'error';row.error=safeError(error);if(error.currentSystemResult)row.currentSystem=error.currentSystemResult;}
    row.elapsedMs=Math.round(performance.now()-start);
    row.knownOpenRouterUsd=trace.reduce((sum,t)=>sum+(validCost(t.response?.usage?.cost)?t.response.usage.cost:0),0);
    row.unknownCostCalls=trace.filter(t=>!validCost(t.response?.usage?.cost)).length;
    row.searchCalls=row.currentSystem?.searchCalls??null;
    row.serverSearchCalls=trace.map(t=>t.response?.usage?.server_tool_use_details?.web_search_requests??t.response?.usage?.server_tool_use?.web_search_requests??null);
    rows.push(row);save(join(output,`${row.id}.json`),row);save(join(output,'budget.json'),budget.snapshot());
    writeReport(output,{plan,rows,cases,budget:budget.snapshot()});
    console.log(JSON.stringify({progress:`${index+1}/${jobs.length}`,caseId:row.caseId,model:row.model,arm:row.arm,status:row.status,
      ms:row.elapsedMs,cost:row.knownOpenRouterUsd,error:row.error,accounted:budget.snapshot().knownOpenRouterUsd}));
  }
  };
  await Promise.all(Array.from({length:concurrency},worker));
  save(join(output,'summary.json'),{plan,previousCells:priorKeys.size,completedCells:rows.length,unrunCells:jobs.length-rows.length,budget:budget.snapshot()});
  console.log(`Results: ${output}`);
  } finally {closeSync(lock);unlinkSync(ledgerLock);}
}

main().catch(e=>{console.error(safeError(e));process.exitCode=1;});
