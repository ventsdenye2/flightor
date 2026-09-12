import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const baselineModules = new Map();

async function loadBaseline(baselineRoot) {
  const root = resolve(baselineRoot);
  if (!baselineModules.has(root)) {
    const loading = (async () => {
      const require = createRequire(pathToFileURL(join(root, 'backend/package.json')));
      const api = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
      const register = api.register ?? api.default?.register;
      const loader = register({ namespace: `research-lab-${randomUUID()}`, tsconfig: join(root, 'backend/tsconfig.json') });
      try {
        const modules = await Promise.all([
          'research-agent/production.ts',
          'research-agent/providers/serpapi.ts',
          'providers/openrouter/research.ts',
          'providers/serpapi/client.ts',
        ].map(file => loader.import(pathToFileURL(join(root, 'backend/src', file)).href, import.meta.url)));
        return Object.assign({}, ...modules);
      } finally {
        await loader.unregister();
      }
    })();
    baselineModules.set(root, loading);
    loading.catch(() => baselineModules.delete(root));
  }
  return baselineModules.get(root);
}

// Provider exception messages can contain credentials or URLs. Diagnostics retain
// categorical error identity only; the runner owns its completion/cost ledger.
function errorIdentity(error) {
  const safe = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(value) ? value : undefined;
  return { name: safe(error?.name) ?? 'Error', ...(safe(error?.code) ? { code: error.code } : {}) };
}

function abortIfNeeded(signal) {
  if (signal.aborted) throw signal.reason ?? new DOMException('Research was cancelled', 'AbortError');
}

/**
 * Execute the existing research component, not a CloudPlanner/Goal E2E flow.
 * testCase.brief is a backend ResearchBrief. complete accepts an object and
 * returns the backend ChatCompletion; its caller retains usage and cost data.
 * onSearch reserves one SerpApi request before dispatch (including failed or
 * cancelled requests). Errors expose their accounting on currentSystemResult.
 */
export async function runCurrentSystem({ baselineRoot, testCase, complete, model, signal, onSearch } = {}) {
  const stop = new AbortController();
  const activeSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  const pendingSearches = new Set();
  const searches = [];
  const synthesis = { status: 'not_started', completionCalls: 0, startedAt: null, elapsedMs: null };
  const warnings = [];
  let searchCalls = 0;
  let artifact = null;
  const snapshot = () => ({
    artifact,
    searchCalls,
    warnings: [...new Set([...warnings, ...(artifact?.warnings ?? [])])],
    raw: { scope: 'research-component', searches: structuredClone(searches), synthesis: structuredClone(synthesis), aborted: activeSignal.aborted },
  });

  try {
    if (typeof baselineRoot !== 'string' || !baselineRoot.trim()) throw new TypeError('baselineRoot is required');
    if (!testCase?.brief) throw new TypeError('testCase.brief is required');
    if (typeof complete !== 'function') throw new TypeError('complete is required');
    if (typeof model !== 'string' || !model.trim()) throw new TypeError('model is required');
    if (onSearch !== undefined && typeof onSearch !== 'function') throw new TypeError('onSearch must be a function');
    abortIfNeeded(activeSignal);

    const { ProductionResearchAgent, SerpApiResearchSearchProvider, OpenRouterResearchSynthesisModel, SerpApiClient } = await loadBaseline(baselineRoot);
    abortIfNeeded(activeSignal);
    const apiKey = process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY;
    if (!apiKey) {
      const error = new Error('SerpApi is not configured');
      error.code = 'PROVIDER_NOT_CONFIGURED';
      throw error;
    }
    const client = new SerpApiClient({
      SERPAPI_KEY: apiKey,
      SERPAPI_BASE_URL: process.env.SERPAPI_BASE_URL || 'https://serpapi.com/search.json',
    });
    const searchProvider = new SerpApiResearchSearchProvider({
      searchOrganic(input, callSignal) {
        const started = performance.now();
        const trace = { query: input.query, limit: input.limit, status: 'reserving', dispatched: false,
          startedAt: new Date().toISOString(), elapsedMs: null };
        searches.push(trace);
        const operation = (async () => {
          try {
            abortIfNeeded(activeSignal);
            try {
              await onSearch?.({ provider: 'serpapi' });
            } catch (error) {
              trace.status = 'reservation_rejected';
              // The production component degrades on provider exceptions. A
              // rejected budget reservation must instead stop the whole run.
              stop.abort(error);
              throw error;
            }
            abortIfNeeded(activeSignal);
            searchCalls += 1;
            trace.dispatched = true;
            trace.status = 'running';
            const results = await client.searchOrganic(input, callSignal);
            abortIfNeeded(activeSignal);
            trace.status = 'succeeded';
            trace.resultCount = results.length;
            return results;
          } catch (error) {
            if (trace.status !== 'reservation_rejected') trace.status = activeSignal.aborted ? 'cancelled' : 'failed';
            trace.error = errorIdentity(error);
            warnings.push(`current_system_search_${trace.status}`);
            throw error;
          } finally {
            trace.elapsedMs = Math.round(performance.now() - started);
          }
        })();
        pendingSearches.add(operation);
        operation.then(() => pendingSearches.delete(operation), () => pendingSearches.delete(operation));
        return operation;
      },
    });
    const productionSynthesis = new OpenRouterResearchSynthesisModel({
      complete: async (messages, selectedModel, options) => {
        synthesis.completionCalls += 1;
        return complete({ messages, model: selectedModel, options });
      },
    }, model);
    const synthesisModel = {
      async synthesize(input, options) {
        const started = performance.now();
        synthesis.startedAt = new Date().toISOString();
        synthesis.status = 'running';
        try {
          const result = await productionSynthesis.synthesize(input, options);
          synthesis.status = 'succeeded';
          synthesis.findingCount = result.length;
          return result;
        } catch (error) {
          synthesis.status = activeSignal.aborted ? 'cancelled' : 'failed';
          synthesis.error = errorIdentity(error);
          warnings.push(`current_system_synthesis_${synthesis.status}`);
          throw error;
        } finally {
          synthesis.elapsedMs = Math.round(performance.now() - started);
        }
      },
    };
    // Match routes/agent-cloud.ts: intentionally no query planner or overrides.
    const agent = new ProductionResearchAgent({ searchProvider, synthesisModel });
    artifact = await agent.research(structuredClone(testCase.brief), {
      requestId: `lab-${randomUUID()}`,
      signal: activeSignal,
      ...(testCase.context?.preferenceSummary !== undefined ? { preferenceSummary: testCase.context.preferenceSummary } : {}),
    });
    abortIfNeeded(activeSignal);
    return snapshot();
  } catch (error) {
    // Production rolling workers can reject early on cancellation; wait until
    // already-dispatched calls settle so no costs appear after the snapshot.
    stop.abort(error);
    await Promise.allSettled([...pendingSearches]);
    const result = snapshot();
    result.raw.error = errorIdentity(error);
    const failure = new Error('Current research component did not complete');
    failure.name = signal?.aborted ? 'AbortError' : 'CurrentSystemError';
    failure.code = errorIdentity(error).code ?? (signal?.aborted ? 'RESEARCH_CANCELLED' : 'CURRENT_SYSTEM_FAILED');
    failure.currentSystemResult = result;
    throw failure;
  }
}
