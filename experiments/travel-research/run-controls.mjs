// Execution status must not be overwritten by a weaker evidence diagnostic.
export function classifyResponse(response, structured, result) {
  const diagnostics = [];
  if (structured && result?.valid && result.findings.some(f => !f.citationLinked || f.unlinkedUrls.length > 0)) {
    diagnostics.push('unlinked_evidence');
  }
  const incomplete = ['length', 'content_filter', 'tool_calls'].includes(response.finishReason)
    || Boolean(response.message?.tool_calls?.length);
  return {status: incomplete ? 'incomplete'
    : structured && !result?.valid ? 'invalid_output'
    : diagnostics.includes('unlinked_evidence') ? 'unlinked_evidence' : 'responded', diagnostics};
}

// Filters and repeats may differ for a continuation, but the experiment itself
// must be identical. Comparing source bytes also catches forgotten version bumps.
const criticalFiles = ['run.mjs', 'run-controls.mjs', 'openrouter.mjs', 'contracts.mjs', 'current-system.mjs'];
export function assertCompatibleManifest(previous, current) {
  const reject = field => { throw new Error(`PREVIOUS_RUN_CONFIGURATION_MISMATCH:${field}`); };
  for (const field of ['casesHash', 'modelsHash']) {
    if (!current[field] || previous[field] !== current[field]) reject(field);
  }
  for (const field of ['protocol', 'engineMode', 'concurrency']) {
    if (previous.plan?.[field] !== current.plan?.[field]) reject(field);
  }
  for (const path of criticalFiles) {
    const before = previous.runnerFiles?.find(file => file.path === path)?.sha256;
    const after = current.runnerFiles?.find(file => file.path === path)?.sha256;
    if (!after || before !== after) reject(path);
  }
  if (previous.plan?.arms?.includes('current-system') && current.plan?.arms?.includes('current-system')
    && (!current.baselineHash || previous.baselineHash !== current.baselineHash)) reject('baselineHash');
}
