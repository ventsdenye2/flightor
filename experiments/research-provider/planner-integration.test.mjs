import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {createThinResearchAgent} from './thin-research.mjs';
import {createFixture, runResearchScenario} from './planner-integration.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

// Explicitly synthetic evidence: these URLs are never fetched. Two independent
// example hosts exercise the unchanged domain's partially_verified branch.
function receipt({eligible = false, content} = {}) {
  const urls = ['https://source-a.example/culture', ...(eligible ? ['https://source-b.example/culture'] : [])];
  return {message: {role: 'assistant', content: content ?? JSON.stringify({
    disposition: 'partial', findings: [{destinationIndex: 0, category: 'activity',
      title: 'Synthetic cultural venue', summary: '合成测试来源描述，不是实际旅行事实。', sourceUrls: urls}],
    uncertainties: ['出行日的设施开放及预约状态未核实。'],
  }), annotations: urls.map(url => ({type: 'url_citation', url_citation: {
    url, title: 'Synthetic source fixture', content: 'Synthetic cultural venue evidence for domain integration tests only.',
  }}))}, finishReason: 'stop', searchCalls: 1};
}

async function thinFixture(t, options = {}) {
  const model = options.model ?? 'qwen/qwen3.8-flash';
  const requests = [];
  const fixture = await createFixture({
    researchFactory: ({modules, audits}) => createThinResearchAgent({
      ...modules, model, now: () => new Date(),
      ...(model.startsWith('z-ai/') ? {modelOptions: {reasoning: {enabled: true, effort: 'low', exclude: true}}} : {}),
      complete: async request => {
        requests.push(request.body);
        assert.equal(request.body.model, model);
        assert.equal(request.body.provider.allow_fallbacks, true);
        return structuredClone(options.response ?? receipt(options));
      },
      saveAudit: async audit => { audits.push(structuredClone(audit)); },
    }),
  });
  t.after(() => fixture.close());
  fixture.requests = requests;
  return fixture;
}

const output = (report, name) => {
  const entry = report.toolOutputs.findLast(value => value.name === name);
  assert.ok(entry, `${name} must be an actual executed tool`);
  return entry;
};

function rawArtifact(brief) {
  const checkedAt = new Date().toISOString();
  return {id: 'late-provider-result', type: 'research', schemaVersion: 2, brief: structuredClone(brief),
    findings: [{id: 'late-finding', category: 'activity', destinations: brief.destinations,
      title: 'Late synthetic finding', summary: 'Late provider fixture.',
      sources: [{url: 'https://source-a.example/culture', domain: 'source-a.example',
        title: 'Synthetic source', snippet: 'Synthetic snippet.', authority: 'unknown'}],
      verification: {status: 'unverified', confidence: 0.2, checkedAt,
        sources: [{provider: 'research-search', reference: 'https://source-a.example/culture'}]},
      warnings: ['evidence_unverified']}], queryCount: 1, warnings: [], createdAt: checkedAt};
}

async function delayedFixture(t) {
  const started = deferred(), release = deferred();
  const fixture = await createFixture({research: {async research(brief) {
    started.resolve();
    await release.promise; // Deliberately ignores AbortSignal; domain must still reject late writes.
    return rawArtifact(brief);
  }}});
  t.after(async () => { release.resolve(); await fixture.close(); });
  return {fixture, started, release};
}

for (const model of ['qwen/qwen3.8-flash', 'z-ai/glm-5.3-flash']) {
  test(`${model}: synthetic transport persists real research lineage but unverified evidence cannot complete`, async t => {
    const f = await thinFixture(t, {model});
    const report = await runResearchScenario(f, {attemptGuide: true});
    const research = output(report, 'web_research');
    assert.equal(research.outcome.ok, true);
    assert.equal(research.output.data.summary.statusCounts.unverified, 1);
    assert.equal(report.artifacts.length, 1);
    const record = report.artifacts[0];
    const declaration = output(report, 'declare_goal').output.data;
    assert.equal(record.type, 'research');
    assert.equal(record.payload.id, record.id);
    assert.equal(record.goalId, declaration.goal.id);
    assert.equal(record.runId, declaration.run.id);
    assert.equal(record.tripContextVersion, f.trip.context.version);
    assert.deepEqual(record.payload.brief, f.brief);
    assert.match(record.payload.warnings.join('\n'), /未核实/);
    assert.ok(record.payload.warnings.some(warning => warning.startsWith('thin_research_audit:')));
    const save = output(report, 'save_travel_guide').output.data;
    assert.equal(save.status, 'needs_revision');
    assert.ok(save.issues.includes('eligible_research_evidence'));
    assert.notEqual(report.result.delivery.status, 'satisfied');
    assert.notEqual(report.result.stopReason, 'completed');
    assert.equal(f.requests.length, 1);
    assert.equal(f.audits.length, 1);
    assert.ok(f.modelCalls.every(call => call.model === 'offline/scripted-planner'));
    const run = await f.runs.get(declaration.run.id);
    assert.ok(run.workingSet.artifactRefs.some(ref => ref.id === record.id));
    const history = await f.conversations.listMessages(f.conversation.id);
    assert.deepEqual(history.at(-1).metadata.delivery, report.result.delivery);
  });
}

test('separate synthetic eligible evidence saves the real authored guide and passes finish_goal', async t => {
  const f = await thinFixture(t, {eligible: true});
  const report = await runResearchScenario(f, {attemptGuide: true});
  const research = report.artifacts.find(record => record.type === 'research');
  assert.equal(research.payload.findings[0].verification.status, 'partially_verified');
  assert.equal(output(report, 'save_travel_guide').output.data.status, 'saved');
  const finish = output(report, 'finish_goal').output.data;
  assert.equal(finish.verification.status, 'satisfied');
  assert.equal(report.result.delivery.status, 'satisfied');
  assert.equal(report.result.stopReason, 'completed');
  assert.deepEqual(new Set(report.artifacts.map(record => record.type)), new Set(['research', 'route', 'travel_guide']));
  const guide = report.artifacts.find(record => record.type === 'travel_guide');
  assert.equal(guide.payload.composition, 'agent_authored');
  assert.equal(guide.payload.days[0].items[0].description, research.payload.findings[0].summary);
  assert.equal(guide.payload.days[0].items[0].sourceArtifactId, research.id);
  assert.ok(guide.sourceArtifactIds.includes(research.id));
  assert.ok(guide.sourceArtifactIds.includes(guide.payload.routeArtifactId));
  assert.equal((await f.goals.get(finish.goal.id)).status, 'satisfied');
  assert.equal((await f.runs.get(finish.run.id)).status, 'satisfied');
});

test('malformed provider content remains a tool failure with an audit and no persisted research', async t => {
  const f = await thinFixture(t, {response: receipt({content: 'not JSON and not a candidate result'})});
  const report = await runResearchScenario(f);
  assert.equal(output(report, 'web_research').outcome.ok, false);
  assert.equal(report.artifacts.length, 0);
  assert.notEqual(report.result.delivery.status, 'satisfied');
  assert.equal(f.audits.length, 1);
});

test('parent cancellation prevents an uncooperative late research response from writing', async t => {
  const {fixture: f, started, release} = await delayedFixture(t);
  const controller = new AbortController();
  const running = runResearchScenario(f, {signal: controller.signal});
  const observed = running.then(value => ({value}), error => ({error}));
  await started.promise;
  controller.abort(new Error('offline cancellation'));
  const result = await observed;
  assert.ok(result.error, 'CloudPlannerService must observe the cancelled request');
  release.resolve();
  await f.drain();
  assert.deepEqual(await f.artifacts.listForTrip(f.trip.id), []);
  assert.equal(f.toolOutputs.findLast(entry => entry.name === 'web_research').outcome.ok, false);
  assert.equal((await f.conversations.listMessages(f.conversation.id)).filter(message => message.role === 'assistant').length, 0);
});

test('durable Goal cancellation rejects a late write even without aborting the transport', async t => {
  const {fixture: f, started, release} = await delayedFixture(t);
  const running = runResearchScenario(f);
  await started.promise;
  const goal = (await f.goals.listForTrip(f.trip.id))[0];
  const run = (await f.runs.listForGoal(goal.id))[0];
  await f.runs.commitCompletion({goalId: goal.id, runId: run.id,
    expectedGoalRevision: goal.revision, expectedRunRevision: run.revision,
    goalStatus: 'cancelled', runStatus: 'cancelled', currentTripVersion: f.trip.context.version});
  release.resolve();
  const report = await running;
  assert.equal(output(report, 'web_research').outcome.ok, false);
  assert.equal(report.artifacts.length, 0);
  assert.equal(report.result.delivery.status, 'cancelled');
  assert.equal((await f.runs.get(run.id)).status, 'cancelled');
});

test('a Trip change during research rejects late evidence and stale completion', async t => {
  const {fixture: f, started, release} = await delayedFixture(t);
  const running = runResearchScenario(f);
  await started.promise;
  await f.trips.update(f.trip.id, {interests: ['changed during research']}, f.trip.context.version);
  release.resolve();
  const report = await running;
  assert.equal(output(report, 'web_research').outcome.ok, false);
  assert.equal(report.artifacts.length, 0);
  assert.equal(report.result.tripVersion, 1);
  assert.notEqual(report.result.delivery.status, 'satisfied');
  const goal = (await f.goals.listForTrip(f.trip.id))[0];
  const run = (await f.runs.listForGoal(goal.id))[0];
  await assert.rejects(f.runs.commitCompletion({goalId: goal.id, runId: run.id,
    expectedGoalRevision: goal.revision, expectedRunRevision: run.revision,
    goalStatus: 'satisfied', runStatus: 'satisfied', currentTripVersion: 0}), {code: 'TRIP_CONTEXT_VERSION_CONFLICT'});
});

test('resume activates a new run and reuses compatible saved research without another provider call', async t => {
  const f = await thinFixture(t, {eligible: true});
  const first = await runResearchScenario(f, {attemptGuide: false});
  const research = first.artifacts.find(record => record.type === 'research');
  const goal = (await f.goals.listForTrip(f.trip.id))[0];
  const oldRun = (await f.runs.listForGoal(goal.id))[0];
  await f.runs.commitCompletion({goalId: goal.id, runId: oldRun.id,
    expectedGoalRevision: goal.revision, expectedRunRevision: oldRun.revision,
    goalStatus: 'partial', runStatus: 'partial', currentTripVersion: f.trip.context.version});
  const second = await runResearchScenario(f, {resumeGoalId: goal.id, researchArtifactId: research.id, attemptGuide: true});
  const resumed = output(second, 'resume_goal').output.data.run;
  assert.notEqual(resumed.id, oldRun.id);
  assert.equal(output(second, 'read_artifact').outcome.ok, true);
  assert.ok(second.toolOutputs.every(entry => entry.name !== 'web_research'));
  assert.equal(f.researchCalls, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(second.result.delivery.status, 'satisfied');
  assert.equal((await f.artifacts.get(research.id)).runId, oldRun.id, 'old evidence is never relabelled');
  const guide = second.artifacts.find(record => record.type === 'travel_guide');
  assert.equal(guide.runId, resumed.id);
  assert.ok(guide.sourceArtifactIds.includes(research.id));
});

test('the real repository rejects another owner reading or composing from saved research', async t => {
  const f = await thinFixture(t);
  const report = await runResearchScenario(f);
  const record = report.artifacts[0];
  const other = new f.modules.InMemoryArtifactRepository('different-owner', new Set([f.trip.id]), f.artifactRecords);
  assert.equal(await other.get(record.id), undefined);
  await assert.rejects(other.create({id: randomUUID(), tripId: f.trip.id, type: 'travel_guide', schemaVersion: 1,
    tripContextVersion: f.trip.context.version, sourceArtifactIds: [record.id], payload: {}}), {code: 'RESOURCE_NOT_FOUND'});
  assert.equal((await f.artifacts.listForTrip(f.trip.id)).length, 1);
});

test('default fixture has no research transport and cannot accidentally dispatch a provider', async t => {
  const f = await createFixture();
  t.after(() => f.close());
  const report = await runResearchScenario(f);
  assert.equal(output(report, 'web_research').outcome.ok, false);
  assert.equal(report.artifacts.length, 0);
  assert.equal(f.audits.length, 0);
  assert.notEqual(report.result.delivery.status, 'satisfied');
});
