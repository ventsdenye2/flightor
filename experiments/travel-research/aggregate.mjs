import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {summarize} from './report.mjs';
import {reviewProjection,normalizeCurrentArtifact} from './projection.mjs';
import {normalizeResearchResponse} from './normalization.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const cases=JSON.parse(readFileSync(join(here,'cases.json'),'utf8'));
const args=process.argv.slice(2),out=resolve(args[0]??join(here,'.runs/aggregate'));
const directories=args.slice(1).map(p=>resolve(p));
if(!directories.length)throw new Error('Usage: node aggregate.mjs OUTPUT RUN_DIRECTORY...');
mkdirSync(out,{recursive:true});
const rows=[],manifests=[];
for(const directory of directories){
  const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
  manifests.push({directory,...manifest});
  for(const file of readdirSync(directory).filter(n=>/^sample-\d+\.json$/.test(n))){
    const row=JSON.parse(readFileSync(join(directory,file),'utf8'));
    const testCase=cases.find(c=>c.id===row.caseId);
    rows.push({...row,id:`${basename(directory)}/${row.id}`,sourceFile:join(directory,file),
      protocol:manifest.plan.protocol??'research-v1',concurrency:manifest.plan.concurrency??1,
      ...(row.currentSystem?.artifact?{result:normalizeCurrentArtifact(row.currentSystem.artifact,testCase)}:{})});
  }
}
const groups=new Map();
for(const row of rows){const key=`${row.protocol}; concurrency=${row.concurrency}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
// Keep the offline ablation separate from row.result and every live sample.
// Missing content is passed through as invalid, never reconstructed from traces.
const normalizationRows=rows.filter(row=>row.arm==='thin-web').map(row=>{
  const result=normalizeResearchResponse(row.content,cases.find(c=>c.id===row.caseId),row.citations??[]);
  return {sampleId:row.id,sourceFile:row.sourceFile,caseId:row.caseId,protocol:row.protocol,concurrency:row.concurrency,
    model:row.model,arm:row.arm,engine:row.engine,status:row.status,
    hasContent:typeof row.content==='string'&&row.content.trim().length>0,
    rawValid:result.raw.valid,normalizedValid:result.normalized.valid,
    transforms:result.transforms,elapsedMs:result.elapsedMs,raw:result.raw,normalized:result.normalized};
});
const normalizationGroups=new Map();
for(const row of normalizationRows){
  const key=JSON.stringify([row.protocol,row.concurrency,row.model,row.engine]);
  if(!normalizationGroups.has(key))normalizationGroups.set(key,{protocol:row.protocol,concurrency:row.concurrency,
    model:row.model,engine:row.engine,n:0,rawValid:0,normalizedValid:0,normalizedOnly:0,missingContent:0,failedOrTimedOut:0,offlineElapsedMs:0});
  const group=normalizationGroups.get(key);
  group.n++;group.rawValid+=Number(row.rawValid);group.normalizedValid+=Number(row.normalizedValid);
  group.normalizedOnly+=Number(!row.rawValid&&row.normalizedValid);group.missingContent+=Number(!row.hasContent);
  group.failedOrTimedOut+=Number(['error','timeout'].includes(row.status));group.offlineElapsedMs+=row.elapsedMs;
}
const normalizationSummary=[...normalizationGroups.values()];
const lines=['# 研究组件评测：协议分组汇总','',
  `生成时间：${new Date().toISOString()}。共 ${rows.length} 条样本（含可用性探测、失败和旧协议），覆盖 ${new Set(rows.filter(r=>r.arm!=='probe').map(r=>r.caseId)).size}/16 个案例。`,
  '', '这些是运行和数据契约诊断，不是人工质量总分，也不是完整 Planner / 保存恢复 / UI 的验收。旧协议、并发与模型参数变化分别分组，不合并成模型榜单。',
  '', '结构通过率是一个明确的技术评分：合规输出数÷该组全部实际尝试数×100。API 错误也留在分母；直接文本没有 JSON 合同，记 N/A。证据是否真实仍须逐条核验。'];
for(const [protocol,items] of groups){
  lines.push('',`## ${protocol}`,'','| 模型 / 方案 / 搜索 | n | 返回内容 | 结构通过率 | 错误或超时 | p50 秒，含失败 | 已知调用美元 | 未知回执 | SerpApi次数 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for(const g of summarize(items)){
    const na=g.key.includes('direct-web')||g.key.includes('probe');
    lines.push(`| ${g.key.replaceAll(' | ',' / ')} | ${g.n} | ${g.responded} | ${na?'N/A':`${(100*g.valid/g.n).toFixed(0)}% (${g.valid}/${g.n})`} | ${g.errors} | ${(g.p50Ms/1000).toFixed(2)} | ${g.knownUsd.toFixed(6)} | ${g.unknownCalls} | ${g.serpApiRequests} |`);
  }
  const normalizedGroups=normalizationSummary.filter(g=>`${g.protocol}; concurrency=${g.concurrency}`===protocol);
  if(normalizedGroups.length){
    lines.push('', '### thin-web 离线机械归一化消融','',
      '| 模型 / 搜索 | n，含失败超时 | 原始契约通过率 | 机械归一化通过率 | 仅归一化后通过 | 无 content | 失败或超时 | 离线处理毫秒合计 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for(const g of normalizedGroups){
      lines.push(`| ${g.model} / ${g.engine} | ${g.n} | ${(100*g.rawValid/g.n).toFixed(1)}% (${g.rawValid}/${g.n}) | ${(100*g.normalizedValid/g.n).toFixed(1)}% (${g.normalizedValid}/${g.n}) | ${g.normalizedOnly} | ${g.missingContent} | ${g.failedOrTimedOut} | ${g.offlineElapsedMs.toFixed(3)} |`);
    }
    lines.push('', '原始契约与归一化结果分别由同一个 parseResearch 验证；原始失败不会被覆盖。失败和超时保留在 n 中，缺少 content 的样本不可修复。只处理 thin-web，不处理 direct-web。',
      '允许的机械操作只有提取唯一尾部 JSON fence、提取无分隔符前言后的单一 JSON object，以及删除未知顶层/候选字段；不补字段，不改内容、URL、日期或类别。',
      '离线处理耗时包含本次解析和投影，未计入或替换原 live 延迟；没有额外模型调用，也没有验证事实。逐样本原始通过状态、归一化通过状态、转换路径及结果见 normalization-results.json。');
  }
}
lines.push('', '已知调用美元仅累加样本 usage.cost，不包含后来核对的未知请求费用；共享 budget-ledger.json 才是准入账本。SerpApi 套餐成本未知。快速报错会拉低 p50，因此不能据此宣称模型更快。',
  '', '## 完成覆盖','', '| 协议 / 模型 / 方案 | 不同案例 / 16 |', '| --- | ---: |');
const coverage=new Map();
for(const row of rows.filter(r=>r.arm!=='probe')){const key=[row.protocol,row.model,row.arm].join(' / ');if(!coverage.has(key))coverage.set(key,new Set());coverage.get(key).add(row.caseId);}
for(const [key,set] of coverage)lines.push(`| ${key} | ${set.size}/16 |`);
writeFileSync(join(out,'report.md'),lines.join('\n')+'\n');
writeFileSync(join(out,'all-results.json'),JSON.stringify({manifests,rows},null,2)+'\n');
writeFileSync(join(out,'normalization-results.json'),JSON.stringify({
  scope:'thin-web-offline-structural-normalization',generatedAt:new Date().toISOString(),
  sourceHashes:Object.fromEntries(['normalization.mjs','contracts.mjs','cases.json'].map(file=>[file,createHash('sha256').update(readFileSync(join(here,file))).digest('hex')])),
  groups:normalizationSummary,rows:normalizationRows
},null,2)+'\n');
writeFileSync(join(out,'blind-review.json'),JSON.stringify(rows.filter(r=>r.arm!=='probe').map(row=>reviewProjection(row,cases.find(c=>c.id===row.caseId))),null,2)+'\n');
console.log(JSON.stringify({samples:rows.length,cases:new Set(rows.filter(r=>r.arm!=='probe').map(r=>r.caseId)).size,
  normalization:normalizationSummary,report:join(out,'report.md')}));
