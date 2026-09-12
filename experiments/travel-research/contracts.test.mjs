import test from 'node:test';
import assert from 'node:assert/strict';
import { Budget } from './budget.mjs';
import { parseResearch,citationSources,safeUrl,schemaForCase,researchMessages } from './contracts.mjs';
import { summarize,percentile } from './report.mjs';
const testCase={brief:{destinations:[{}],maxResults:6,researchTypes:['activity']}};
const finding={destinationIndex:0,category:'activity',title:'Venue',summary:'Recommendation',sourceUrls:['https://example.org/visit']};
const value=(overrides={})=>JSON.stringify({disposition:'recommend',findings:[finding],uncertainties:[],...overrides});

test('URL fabricated by model is not silently upgraded to verified evidence',()=>{
  const result=parseResearch(value(),testCase,[]);
  assert.equal(result.valid,true);assert.equal(result.citationLinkedCount,0);assert.equal(result.findings[0].verification,'unverified');
});
test('the advertised API and prompt schema share case category and count constraints',()=>{
  const schema=schemaForCase(testCase);
  assert.deepEqual(schema.properties.findings.items.properties.category.enum,['activity']);
  assert.equal(schema.properties.findings.maxItems,6);
  assert.ok(researchMessages(testCase,true,'2026-09-13T00:00:00Z')[0].content.includes(JSON.stringify(schema)));
});
test('citation linked is still unverified; unsafe URLs and foreign destination indexes reject',()=>{
  const sources=citationSources({annotations:[{type:'url_citation',url_citation:{url:finding.sourceUrls[0]}}]});
  assert.equal(parseResearch(value(),testCase,sources).citationLinkedCount,1);
  assert.equal(safeUrl('https://user:secret@example.org'),null);
  assert.equal(parseResearch(value({findings:[{...finding,destinationIndex:1}]}),testCase,sources).valid,false);
  assert.equal(parseResearch(value({findings:[{...finding,sourceUrls:['javascript:alert(1)']}]}),testCase,sources).valid,false);
});
test('duplicate, over-limit, missing and extra fields fail; explicit clarification can be empty',()=>{
  for(const content of [value({findings:[finding,finding]}),value({findings:Array(7).fill(finding)}),value({extra:true}),value({findings:[]})]){
    assert.equal(parseResearch(content,testCase,[]).valid,false);
  }
  assert.equal(parseResearch(value({disposition:'clarify',findings:[],uncertainties:['需要日期']}),testCase,[]).valid,true);
});
test('reservations prevent parallel overspend admission and retain uncertain billing',()=>{
  const budget=new Budget(.5,.25,1);const a=budget.reserve(),b=budget.reserve();
  assert.throws(()=>budget.reserve(),/BUDGET_EXHAUSTED/);budget.settle(a,undefined);
  assert.throws(()=>budget.reserve(),/BILLING_UNKNOWN_STOP/);budget.settle(b,.1);
  assert.equal(budget.snapshot().unknownCalls,1);assert.equal(budget.snapshot().knownOpenRouterUsd,.1);
  assert.throws(()=>budget.settle(b,0),/UNKNOWN_RESERVATION/);
  assert.throws(()=>budget.reserveSearch(),/BILLING_UNKNOWN_STOP/);
  const searchable=new Budget(.5,.25,1);
  searchable.reserveSearch();assert.throws(()=>searchable.reserveSearch(),/SEARCH_BUDGET_EXHAUSTED/);
});
test('small samples never publish p95 and failures remain in latency denominators',()=>{
  const base={model:'model',arm:'thin-web',engine:'exa',knownOpenRouterUsd:0,unknownCostCalls:0};
  const [result]=summarize([{...base,status:'error',elapsedMs:100},{...base,status:'responded',elapsedMs:10000}]);
  assert.equal(result.n,2);assert.equal(result.errors,1);assert.equal(result.p95Ms,null);assert.equal(result.p50Ms,100);
  assert.equal(percentile([],0.5),null);
});
