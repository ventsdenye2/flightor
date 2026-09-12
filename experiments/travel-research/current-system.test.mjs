import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCurrentSystem } from './current-system.mjs';

const baselineRoot = process.env.FLIGHTOR_BASELINE_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const model = 'fixture/research-model';
const testCase = {
  id: 'offline-current-system',
  brief: {
    destinations: [{ id: 'city-tyo', type: 'city', name: 'Tokyo', countryCode: 'JP' }],
    interests: ['food'],
    questions: ['Where can I visit a food market?'],
    researchTypes: ['activity'],
    maxResults: 2,
  },
};
const fixture = {
  organic_results: [{ title: 'Tokyo food market', snippet: 'Visit a Tokyo food market for local food.', link: 'https://www.gotokyo.org/en/spot/fixture' }],
};
const completion = { message: { role: 'assistant', content: JSON.stringify({ findings: [{
  category: 'activity', destinationIndex: 0, title: 'Food market', summary: 'Visit a Tokyo food market for local food.', sourceIndexes: [0],
}] }) } };
let fetchBefore;
let envBefore;

function assertTiming(trace) {
  assert.equal(new Date(trace.startedAt).toISOString(), trace.startedAt);
  assert.ok(Number.isInteger(trace.elapsedMs) && trace.elapsedMs >= 0);
}

beforeEach(() => {
  fetchBefore = globalThis.fetch;
  envBefore = { SERPAPI_API_KEY: process.env.SERPAPI_API_KEY, SERPAPI_BASE_URL: process.env.SERPAPI_BASE_URL };
  process.env.SERPAPI_API_KEY = 'offline-dummy';
  process.env.SERPAPI_BASE_URL = 'https://serpapi.com/search.json';
  globalThis.fetch = async input => {
    assert.equal(new URL(input).hostname, 'serpapi.com', 'offline tests never call another endpoint');
    return new Response(JSON.stringify(fixture), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});
afterEach(() => {
  globalThis.fetch = fetchBefore;
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('loads the real baseline and reserves each search before dispatch', async () => {
  const events = [];
  const fetchFixture = globalThis.fetch;
  globalThis.fetch = async (...args) => { events.push('fetch'); return fetchFixture(...args); };
  const result = await runCurrentSystem({ baselineRoot, testCase, model,
    onSearch: async event => { assert.deepEqual(event, { provider: 'serpapi' }); events.push('reserve'); },
    complete: async request => {
      assert.equal(request.model, model);
      assert.equal(request.options.maxTokens, 4000);
      assert.equal(request.options.responseFormat.json_schema.name, 'research_findings');
      assert.equal(request.options.reasoning.enabled, false);
      assert.match(request.messages[0].content, /constrained travel research summarizer/);
      assert.equal(JSON.parse(request.messages[1].content).sources[0].snippet, fixture.organic_results[0].snippet);
      events.push('complete');
      return completion;
    },
  });
  assert.deepEqual(events, ['reserve', 'fetch', 'complete']);
  assert.equal(result.artifact.type, 'research');
  assert.equal(result.artifact.schemaVersion, 2);
  assert.equal(result.artifact.findings[0].title, 'Food market');
  assert.equal(result.searchCalls, 1);
  assert.equal(result.raw.scope, 'research-component');
  assert.equal(result.raw.synthesis.status, 'succeeded');
  assertTiming(result.raw.searches[0]);
  assertTiming(result.raw.synthesis);
  assert.ok(Date.parse(result.raw.synthesis.startedAt) >= Date.parse(result.raw.searches[0].startedAt));
});

test('exposes production synthesis fallback and retains search accounting', async () => {
  const result = await runCurrentSystem({ baselineRoot, testCase, model,
    complete: async () => ({ message: { role: 'assistant', content: 'invalid json' } }),
  });
  assert.equal(result.searchCalls, 1);
  assert.equal(result.raw.synthesis.status, 'failed');
  assert.equal(result.raw.synthesis.error.code, 'RESEARCH_SYNTHESIS_INVALID');
  assertTiming(result.raw.synthesis);
  assert.ok(result.warnings.includes('research_synthesis_unavailable_or_invalid'));
  assert.ok(result.warnings.includes('current_system_synthesis_failed'));
  assert.ok(result.artifact.findings[0].warnings.includes('raw_source_requires_synthesis'));
});

test('counts failed dispatched searches without leaking provider exception text', async () => {
  globalThis.fetch = async () => { throw new Error('https://serpapi.com?api_key=never-serialize-this'); };
  const result = await runCurrentSystem({ baselineRoot, testCase, model, complete: async () => assert.fail('No sources to synthesize') });
  assert.equal(result.searchCalls, 1);
  assert.equal(result.raw.searches[0].status, 'failed');
  assertTiming(result.raw.searches[0]);
  assert.equal(result.raw.synthesis.startedAt, null);
  assert.equal(result.raw.synthesis.elapsedMs, null);
  assert.deepEqual(result.artifact.findings, []);
  assert.equal(JSON.stringify(result).includes('never-serialize-this'), false);
});

test('a rejected budget reservation stops the run before a paid search', async () => {
  globalThis.fetch = async () => assert.fail('Budget failure must prevent network dispatch');
  await assert.rejects(runCurrentSystem({ baselineRoot, testCase, model, complete: async () => completion,
    onSearch: async () => { const error = new Error('budget'); error.code = 'BUDGET_EXCEEDED'; throw error; },
  }), error => {
    assert.equal(error.code, 'BUDGET_EXCEEDED');
    assert.equal(error.currentSystemResult.searchCalls, 0);
    assert.equal(error.currentSystemResult.raw.searches[0].status, 'reservation_rejected');
    assertTiming(error.currentSystemResult.raw.searches[0]);
    return true;
  });
});

test('cancellation retains dispatched calls and drains their accounting', async () => {
  const controller = new AbortController();
  globalThis.fetch = async (_input, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    queueMicrotask(() => controller.abort(new DOMException('cancelled', 'AbortError')));
  });
  await assert.rejects(runCurrentSystem({ baselineRoot, testCase, model, signal: controller.signal, complete: async () => completion }), error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.currentSystemResult.searchCalls, 1);
    assert.equal(error.currentSystemResult.raw.searches[0].status, 'cancelled');
    assertTiming(error.currentSystemResult.raw.searches[0]);
    assert.equal(error.currentSystemResult.raw.aborted, true);
    return true;
  });
});

test('an already cancelled run never dispatches or loads a provider', async () => {
  await assert.rejects(runCurrentSystem({ baselineRoot, testCase, model, complete: async () => completion,
    signal: AbortSignal.abort(),
  }), error => {
    assert.equal(error.currentSystemResult.searchCalls, 0);
    assert.deepEqual(error.currentSystemResult.raw.searches, []);
    return true;
  });
});

test('budget rejection drains a second in-flight search before reporting costs', async () => {
  let reservations = 0;
  let dispatchObserved;
  const dispatched = new Promise(resolveDispatch => { dispatchObserved = resolveDispatch; });
  globalThis.fetch = async (_input, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => setTimeout(() => reject(options.signal.reason), 10), { once: true });
    dispatchObserved();
  });
  const parallelCase = { ...testCase, brief: { ...testCase.brief, questions: ['food market', 'cultural venue', 'parks'] } };
  await assert.rejects(runCurrentSystem({ baselineRoot, testCase: parallelCase, model, complete: async () => completion,
    onSearch: async () => {
      reservations += 1;
      if (reservations === 1) return;
      await dispatched;
      const error = new Error('budget');
      error.code = 'BUDGET_EXCEEDED';
      throw error;
    },
  }), error => {
    const result = error.currentSystemResult;
    assert.equal(error.code, 'BUDGET_EXCEEDED');
    assert.equal(result.searchCalls, 1);
    assert.equal(result.raw.searches.length, 2);
    assert.deepEqual(result.raw.searches.map(search => search.status), ['cancelled', 'reservation_rejected']);
    result.raw.searches.forEach(assertTiming);
    return true;
  });
});
