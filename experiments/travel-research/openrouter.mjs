import { performance } from 'node:perf_hooks';

export async function catalog() {
  const res=await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error(`MODEL_CATALOG_HTTP_${res.status}`);
  return (await res.json()).data;
}

export function safeError(error) {
  let message=String(error?.message ?? error).slice(0,1500);
  for (const key of ['OPENROUTER_API_KEY','SERPAPI_KEY','SERPAPI_API_KEY']) {
    if (process.env[key]) message=message.split(process.env[key]).join('[redacted]');
  }
  return message.replace(/([?&](?:api_key|key|token)=)[^\s&]+/gi,'$1[redacted]');
}

export async function complete({body,signal,budget,trace,timeoutMs=95000}) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_NOT_CONFIGURED');
  // Experiment credentials are only sent to the explicit official OpenRouter endpoint.
  const reservation=budget.reserve();
  const entry={request:body,startedAt:new Date().toISOString()};
  trace.push(entry);
  const started=performance.now();
  let cost,rejectedBeforeGeneration=false;
  try {
    const res=await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`},
      body:JSON.stringify(body),signal:AbortSignal.any([signal ?? new AbortController().signal,AbortSignal.timeout(timeoutMs)])
    });
    const raw=await res.json();
    cost=raw.usage?.cost;
    rejectedBeforeGeneration=[400,401,402,403,404,422].includes(res.status)&&!raw.id&&!raw.choices?.length;
    entry.httpStatus=res.status;
    if(raw.error)entry.providerError={code:raw.error.code,message:safeError(raw.error),
      provider:raw.error.metadata?.provider_name,detail:safeError(raw.error.metadata?.raw??'')};
    entry.billingDisposition=rejectedBeforeGeneration?'gateway_rejected_no_generation_reservation_retained':'provider_receipt_or_unknown';
    entry.response={id:raw.id,model:raw.model,provider:raw.provider,usage:raw.usage,finishReason:raw.choices?.[0]?.finish_reason,
      message:raw.choices?.[0]?.message ? {role:raw.choices[0].message.role,content:raw.choices[0].message.content,
        annotations:raw.choices[0].message.annotations,tool_calls:raw.choices[0].message.tool_calls}:null};
    if (!res.ok || raw.error) throw new Error(`OPENROUTER_HTTP_${res.status}: ${raw.error?.message ?? 'request failed'}`);
    if (!raw.choices?.[0]?.message || typeof raw.choices[0].message.content !== 'string') throw new Error('OPENROUTER_MISSING_CONTENT');
    return entry.response;
  } catch(error) { entry.error=safeError(error); throw error; }
  finally { entry.elapsedMs=Math.round(performance.now()-started); budget.settle(reservation,cost,rejectedBeforeGeneration); }
}

export function webBody({model,modelInfo,messages,structured,schema,engine}) {
  return {model:model.id,messages,max_tokens:3200,
    ...(modelInfo.supported_parameters.includes('temperature')?{temperature:0}:{}),
    ...(modelInfo.supported_parameters.includes('reasoning')?{reasoning:model.reasoning??{enabled:false,exclude:true}}:{}),
    provider:{require_parameters:true,allow_fallbacks:true},
    tools:[{type:'openrouter:web_search',parameters:{engine,max_results:5,max_total_results:10,max_uses:2,max_characters:1500}}],
    max_tool_calls:2,
    ...(structured?{response_format:{type:'json_schema',json_schema:{name:'travel_candidates',strict:true,schema}}}:{})};
}
