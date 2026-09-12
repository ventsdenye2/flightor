import {randomUUID} from 'node:crypto';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {loadBackend} from './baseline.mjs';

// This is an offline test driver, never a production orchestration workflow.
// No HTTP client, app/server entry point, environment file or database is loaded.
export const integrationScope = 'offline-scripted-planner; real domain/tools; in-memory persistence; no live model or DB evidence';
export const fixtureCase = {
  id: 'synthetic-planner-contract',
  request: '保存一日文化参观建议，保留来源的部分核实标签。',
  brief: {
    destinations: [{id: 'city:TYO', type: 'city', name: 'Tokyo', countryCode: 'JP', cityCode: 'TYO'}],
    travelWindow: {from: '2026-10-14', to: '2026-10-14'},
    interests: ['文化'], questions: ['研究有来源的文化参观候选。'], researchTypes: ['activity'], maxResults: 4,
  },
};

export const toolCall = (name, args = {}) => ({tool: name, args});
export const reply = content => ({reply: content});

export function latestTool(view, name, {requireSuccess = true} = {}) {
  const entry = view.toolOutputs.findLast(value => value.name === name);
  if (!entry) throw new Error(`OFFLINE_TOOL_OUTPUT_MISSING:${name}`);
  if (requireSuccess && !entry.outcome.ok) throw new Error(`OFFLINE_TOOL_FAILED:${name}:${entry.outcome.errorCode}`);
  return entry.output;
}

function disabledProvider(name) {
  return new Proxy({name: `offline-disabled-${name}`}, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'then') return undefined;
      return async () => { throw new Error(`OFFLINE_PROVIDER_DISABLED:${name}:${String(key)}`); };
    },
  });
}

function contextFromBrief(brief) {
  const {from, to} = brief.travelWindow ?? {};
  const travelDays = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : 1;
  if (!Number.isInteger(travelDays) || travelDays < 1 || travelDays > 60) throw new Error('OFFLINE_TRIP_WINDOW_INVALID');
  return {
    destinationIntent: {mode: 'explicit', required: brief.destinations, preferred: [], excluded: []},
    interests: brief.interests, travelDays,
    ...(from ? {departureWindow: {from, to: from, precision: 'exact'}} : {}),
    ...(to ? {returnWindow: {from: to, to, precision: 'exact'}} : {}),
  };
}

/** Each fixture owns every mutable repository, clock-version mirror and trace. */
export async function createFixture(options = {}) {
  const backend = options.backend ?? await loadBackend(options.baselineRoot);
  const ownsBackend = !options.backend;
  try {
    const modules = Object.assign({}, ...await Promise.all([
      'agent/cloud/service.ts', 'agent/runtime/runtime.ts', 'agent/tools/core.ts',
      'trips/repository.ts', 'conversations/repository.ts', 'artifacts/repository.ts',
      'memory/repository.ts', 'agent/goals/repository.ts', 'agent/goals/default-verifiers.ts',
      'research-agent/types.ts', 'research-agent/verification.ts', 'aviation/types.ts',
    ].map(file => backend.import(file))));
    const testCase = structuredClone(options.testCase ?? fixtureCase);
    const brief = modules.researchBriefSchema.parse(testCase.brief);
    const ownerId = options.ownerId ?? `offline-${randomUUID()}`;
    const trips = new modules.InMemoryTripRepository();
    const trip = await trips.create({title: `Offline ${testCase.id}`, initialContext: {
      ...contextFromBrief(brief), ...options.initialContext,
    }});
    // The real in-memory completion repository takes a synchronous current-version callback.
    const versions = new Map([[trip.id, trip.context.version]]);
    const updateTrip = trips.update.bind(trips);
    trips.update = async (...args) => {
      const value = await updateTrip(...args); versions.set(value.id, value.version); return value;
    };
    const ownedTripIds = new Set([trip.id]);
    const conversations = new modules.InMemoryConversationRepository(ownerId, ownedTripIds);
    const conversation = await conversations.create({tripId: trip.id});
    const goals = new modules.InMemoryGoalRepository(ownerId);
    const runs = new modules.InMemoryGoalRunRepository(ownerId, goals, new Map(), id => versions.get(id));
    const artifactRecords = new Map();
    const artifacts = new modules.InMemoryArtifactRepository(ownerId, ownedTripIds, artifactRecords, {
      goal: id => goals.get(id),
      run: async id => {
        const run = await runs.get(id);
        return run && {...run, tripContextVersion: run.contextVersion};
      },
    });
    const memory = new modules.InMemoryUserMemoryRepository();
    const goalVerifiers = modules.createDefaultGoalVerifierRegistry();
    const audits = [];
    const delegate = options.research ?? (options.researchFactory
      ? await options.researchFactory({backend, modules, audits, testCase})
      : disabledProvider('research'));
    const pending = new Set();
    const fixture = {
      scope: integrationScope, backend, modules, testCase, brief, ownerId, trip, conversation,
      trips, conversations, artifacts, memory, goals, runs, goalVerifiers, audits,
      artifactRecords, ownedTripIds, toolOutputs: [], modelCalls: [], activity: [], researchCalls: 0, turns: [],
    };
    const research = {async research(...args) {
      fixture.researchCalls += 1;
      const task = Promise.resolve().then(() => delegate.research(...args));
      pending.add(task);
      try { return await task; } finally { pending.delete(task); }
    }};
    let turnNumber = 0;
    let active = false;
    fixture.drain = async () => {
      while (pending.size) await Promise.allSettled([...pending]);
      // Let the domain's post-provider checkpoint and late-rejection handlers settle.
      await nextTurn();
    };
    fixture.close = async () => { await fixture.drain(); if (ownsBackend) await backend.close(); };
    fixture.run = async (steps, input = {}) => {
      if (active) throw new Error('OFFLINE_FIXTURE_TURN_ALREADY_RUNNING');
      active = true;
      const turn = ++turnNumber;
      const outputs = [];
      const scriptErrors = [];
      let index = 0;
      const model = {async complete(messages, modelId, modelOptions) {
        fixture.modelCalls.push({turn, model: modelId, messages: structuredClone(messages)});
        modelOptions?.signal?.throwIfAborted();
        try {
          if (index >= steps.length) throw new Error('OFFLINE_SCRIPT_EXHAUSTED');
          const stepIndex = index++;
          const step = steps[stepIndex];
          const action = typeof step === 'function'
            ? await step({fixture, messages, toolOutputs: outputs, index: stepIndex}) : step;
          if (typeof action?.reply === 'string') return {message: {role: 'assistant', content: action.reply}, finishReason: 'stop'};
          if (typeof action?.tool !== 'string') throw new Error('OFFLINE_SCRIPT_ACTION_INVALID');
          return {message: {role: 'assistant', content: null, tool_calls: [{
            id: randomUUID(), type: 'function', function: {name: action.tool, arguments: JSON.stringify(action.args ?? {})},
          }]}, finishReason: 'tool_calls'};
        } catch (error) { scriptErrors.push(error); throw error; }
      }};
      const registry = modules.createPlannerToolRegistry();
      const execute = registry.execute.bind(registry);
      registry.execute = async (call, context, ...args) => {
        const outcome = await execute(call, context, ...args);
        const entry = {turn, name: call.function.name, arguments: JSON.parse(call.function.arguments),
          scope: {goalId: context.activeGoalId, runId: context.activeGoalRunId, tripContextVersion: context.activeGoalContextVersion},
          outcome: structuredClone(outcome), output: JSON.parse(outcome.content)};
        outputs.push(entry); fixture.toolOutputs.push(entry);
        return outcome;
      };
      const runtime = new modules.AgentRuntime(model, registry, {
        model: 'offline/scripted-planner', maxToolSteps: 10, maxCostUnits: 100,
        turnTimeoutMs: options.turnTimeoutMs ?? 10_000,
      });
      const service = new modules.CloudPlannerService({
        ownerId, trips, conversations, artifacts, memory, runtime, research,
        goalRepository: goals, goalRunRepository: runs, goalVerifiers,
        aviation: disabledProvider('aviation'), fares: disabledProvider('fares'),
        connectionSearch: disabledProvider('connection-search'), flightRoutePlanner: disabledProvider('flight-route'),
        routeOptimizer: disabledProvider('route-optimizer'),
      });
      try {
        const result = await service.runTurn({
          requestId: input.requestId ?? `offline-request-${randomUUID()}`,
          generationId: input.generationId ?? `offline-generation-${randomUUID()}`,
          tripId: trip.id, conversationId: conversation.id,
          message: input.message ?? testCase.request ?? brief.questions.join('\n'),
          ...(input.signal ? {signal: input.signal} : {}),
          onActivity: event => fixture.activity.push({turn, ...structuredClone(event)}),
        });
        if (scriptErrors.length) throw scriptErrors[0];
        const report = {scope: integrationScope, baselineHash: backend.manifest.sourceHash,
          result, toolOutputs: outputs, artifacts: await artifacts.listForTrip(trip.id, 100),
          goals: await goals.listForTrip(trip.id), researchCalls: fixture.researchCalls};
        fixture.turns.push(report);
        return report;
      } finally { active = false; }
    };
    return fixture;
  } catch (error) { if (ownsBackend) await backend.close(); throw error; }
}

function goalParameters(fixture) {
  return {questions: fixture.brief.questions.slice(0, 8), researchTypes: fixture.brief.researchTypes,
    maxResults: Math.min(fixture.brief.maxResults ?? 10, 20), maxCities: fixture.brief.destinations.length,
    allowPartial: true, allowRestDays: false};
}

/** Deterministic test selection, not itinerary-quality evidence or production logic. */
export function guideFromResearch(fixture, reference, findings) {
  const count = fixture.trip.context.travelDays ?? 1;
  return {researchArtifactIds: [reference], days: Array.from({length: count}, (_, day) => ({
    day: day + 1, cityId: fixture.brief.destinations[0].id, kind: 'visit', theme: '离线集成测试主题',
    items: findings.filter((_, index) => index % count === day).slice(0, 6).map(finding => ({
      researchIndex: 0, findingId: finding.id, timeOfDay: 'flexible', planningNote: '测试驱动的选择，不代表真实模型规划。',
    })),
  }))};
}

/** Run both candidate providers through exactly the same real Planner/tool vocabulary. */
export async function runResearchScenario(fixture, {attemptGuide = false, guide, resumeGoalId,
  researchArtifactId, finish = true, signal, message} = {}) {
  const steps = [toolCall('get_trip_context')];
  if (resumeGoalId) {
    steps.push(toolCall('get_active_goal', {goalId: resumeGoalId}), toolCall('resume_goal', {goalId: resumeGoalId}));
  } else steps.push(toolCall('declare_goal', {kind: 'travel_guide', parameters: goalParameters(fixture)}));
  steps.push(researchArtifactId ? toolCall('read_artifact', {artifactId: researchArtifactId}) : toolCall('web_research', fixture.brief));
  if (attemptGuide) steps.push(async view => {
    let reference, findings;
    if (researchArtifactId) {
      const read = latestTool(view, 'read_artifact').data;
      if (read.truncated) throw new Error('OFFLINE_RESEARCH_READ_TRUNCATED');
      const payload = JSON.parse(read.content).payload;
      if (read.artifact.type !== 'research' || !Array.isArray(payload?.findings)) throw new Error('OFFLINE_RESEARCH_READ_INVALID');
      reference = read.artifact.id; findings = payload.findings;
    } else {
      const response = latestTool(view, 'web_research', {requireSuccess: false});
      if (!response.ok) return reply('离线研究工具失败，未提交攻略；交付仍由服务器判定。');
      reference = response.data.artifact.id; findings = response.data.findings;
    }
    return toolCall('save_travel_guide', typeof guide === 'function'
      ? await guide({fixture, reference, findings, view}) : guide ?? guideFromResearch(fixture, reference, findings));
  });
  if (finish) steps.push(view => toolCall('finish_goal', {
    goalId: latestTool(view, resumeGoalId ? 'resume_goal' : 'declare_goal').data.goal.id,
  }));
  steps.push(reply('离线测试驱动结束；实际交付状态以服务器验证为准。'));
  return fixture.run(steps, {signal, message});
}
