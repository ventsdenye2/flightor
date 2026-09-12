import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {reviewProjection} from './projection.mjs';

export function percentile(values,q) {
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.ceil(q*sorted.length)-1)];
}

export function summarize(rows) {
  const groups=new Map();
  for(const row of rows){const key=[row.model,row.arm,row.engine].join(' | ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  return [...groups].map(([key,items])=>({key,n:items.length,
    responded:items.filter(x=>['responded','partial','unlinked_evidence','invalid_output','incomplete'].includes(x.status)).length,
    valid:items.filter(x=>x.result?.valid).length,
    withLinkedFindings:items.filter(x=>x.result?.findings?.some(f=>f.citationLinked)).length,
    errors:items.filter(x=>['error','timeout'].includes(x.status)).length,
    p50Ms:percentile(items.map(x=>x.elapsedMs),.5),p95Ms:items.length>=20?percentile(items.map(x=>x.elapsedMs),.95):null,
    knownUsd:items.reduce((s,x)=>s+x.knownOpenRouterUsd,0),unknownCalls:items.reduce((s,x)=>s+x.unknownCostCalls,0),
    serpApiRequests:items.reduce((s,x)=>s+(x.searchCalls??0),0)}));
}

export function writeReport(output,{plan,rows,cases,budget}) {
  const groups=summarize(rows);
  const lines=['# 活动研究实验运行记录','',
    `已运行 ${rows.length}/${plan.cells} 格；每格 ${plan.repeats} 次计划重复。仅 research-component，不能推断完整行程交付或 UI 效果。`,
    '', '**没有自动内容总分或胜出模型。** 结构合法、引用关联只说明机器可读取/URL 来自检索；不能证明事实正确。人工盲评见 rubric.md。',
    '', '| 模型 / 方案 / 搜索 | n | 返回内容 | 结构合法 | 有关联候选 | 错误/超时 | p50 秒（含失败） | p95 秒 | 已知美元 | 未知计费调用 | SerpApi 次数 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for(const g of groups)lines.push(`| ${g.key.replaceAll(' | ',' / ')} | ${g.n} | ${g.responded} | ${g.key.includes('direct-web')?'N/A':g.valid} | ${g.key.includes('direct-web')?'N/A':g.withLinkedFindings} | ${g.errors} | ${(g.p50Ms/1000).toFixed(2)} | ${g.p95Ms===null?'样本不足':(g.p95Ms/1000).toFixed(2)} | ${g.knownUsd.toFixed(6)} | ${g.unknownCalls} | ${g.serpApiRequests} |`);
  lines.push('', 'p50 包含失败时间，快速报错不是高性能。n<20 不报告 p95。direct-web 不要求 JSON，结构列不参与方案排名。',
    'SerpApi 采用独立次数预算；套餐边际成本未知，未算成 0。OpenRouter 返回 usage.cost 时才记为已知费用；超时/缺失回执保留本地预留，不能视为免费。',
    `本地已知 OpenRouter 费用 $${budget.knownOpenRouterUsd.toFixed(6)}，未知预留 $${budget.reservedUnknownUsd.toFixed(2)}；供应商账单是最终依据。`,
    '', '当前体系源码快照与脏文件清单见 baseline-manifest.json；模型价格与参数快照见 manifest.json。引擎字段为请求配置，原生请求可能被网关降级，只有供应商证据能确认实际引擎。',
    '', '## 逐格状态','', '| Sample | Case | 状态 | 秒 | 费用美元（已知） |', '| --- | --- | --- | ---: | ---: |');
  for(const row of rows)lines.push(`| ${row.id} | ${row.caseId} | ${row.status} | ${(row.elapsedMs/1000).toFixed(2)} | ${row.knownOpenRouterUsd.toFixed(6)} |`);
  writeFileSync(join(output,'report.md'),lines.join('\n')+'\n');
  const blind=rows.map(row=>reviewProjection(row,cases.find(c=>c.id===row.caseId)));
  writeFileSync(join(output,'blind-review.json'),JSON.stringify(blind,null,2)+'\n');
  writeFileSync(join(output,'scores-template.json'),JSON.stringify(rows.map(row=>({sampleId:row.id,reviewer:null,
    scores:null,sourceChecks:[],notes:'Pending human review; do not infer factuality from URL presence.'})),null,2)+'\n');
}
