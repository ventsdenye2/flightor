# ADR 0015: Transient Planner progress

- Status: Accepted for the single-process local MVP
- Date: 2026-09-08
- Authority: `docs/FLIGHTOR_ARCHITECTURE.md`; amends ADR 0006 transport only

## Context

The Planner currently holds a single HTTP request open for its entire turn.
The user sees a static thinking message, including while provider tools run.
The user requested a 300-second turn limit and temporary activity feedback,
without adding progress messages to conversation context.

## Decision

The production Planner turn budget is 300 seconds. The temporary task has a
315-second outer deadline to allow final persistence and the existing timeout
reply; the client waits up to 330 seconds. Individual model/provider timeouts
and cancellation safeguards remain bounded independently.

Keep `POST /v1/agent/converse` compatible. The mini-program submits the same
owned Trip/Conversation/message through `POST /v1/agent/turns`, then polls
`GET /v1/agent/turns/:turnId` with short HTTP requests. Both transports invoke
the same Planner service and build the same final response. Submission is not
automatically repeated after an uncertain network failure.

The temporary resource contains its opaque ID, running/completed/failed
status, start/update times, current activity stage and eventual final response
or public error. Ownership is derived from authentication and enforced on every
read. A bounded process-local cache retains completed results briefly; running
tasks are never evicted to admit new ones. Server shutdown cancels its tasks.
This is not a durable job queue: a process restart can lose temporary status.
Persisted conversation messages, Trip state and Artifacts remain authoritative
and can still be restored through the workspace.

Activity stages come from actual model/tool execution events: thinking,
updating trip, searching flights, researching, building itinerary and finalizing.
They contain no reasoning text, tool arguments, prompts or intermediate model
content. A successful status read confirms recent connectivity and running
state; client animation alone does not. Failed or stale reads show that the
connection is being checked, preserving the last confirmed activity as history
of status only. They never claim the Agent is certainly still running.

Client progress lives only in the active send state, outside conversation
messages, history serialization, Memory, Trip and Artifacts. End of request,
logout or workspace switch clears it; late results are guarded by the captured
owner/session/request identity. A component-local clock updates elapsed time.

## Validation

### 2026-09-24 amendment: DSH cancellation acknowledgement

The cancel POST now awaits the service execution Promise before returning its
acknowledgement. In DSH mode, an aborted generation remains `running` until its
parent domain tool promises drain; no new public status/schema is added. Existing
commits remain visible, late publications are fenced, and another turn for the
same owner/Trip/conversation is rejected until execution has settled. Repeated
cancellation waits on the same Promise. The 315-second outer deadline still
reports timeout, but timeout is not proof that business writes have stopped;
the cancel request does not acknowledge a completed drain before it happens.
Terminal but undrained entries cannot be evicted. Legacy synchronous store
cancellation remains compatible; its HTTP cancellation also waits for service
settlement. This does not upgrade legacy runtime settlement to proof of arbitrary
uncooperative provider side effects. DSH's actual parent tool drain is tested
separately in [the session boundary report](../design/budget-travel-agent/DSH_SESSIONS_2026-09-24.md).

### 2026-09-20 amendment: committed results and cancellation (B4)

The existing single-process resource now carries Trip/conversation/generation
scope, a monotonic artifact revision and a bounded current set of compact committed
flight/guide references. Runtime receives notifications only after workspace
repository commit and a cancellation/version/selection checkpoint. Polling
reconciles current domain versions without invalidating newer publications using
an older asynchronous context read. No payload or reasoning enters progress.

Authenticated `POST /v1/agent/turns/:turnId/cancel` aborts a running turn and returns
its terminal snapshot with saved refs; repeated cancellation is safe. New turns in
the same owned Trip/conversation supersede the prior running generation. Late
events and settlement are ignored. This is execution cancellation, not persisted
Goal cancellation or transaction rollback. The client unlocks mutations only after
terminal acknowledgement, keeps committed results on failure/cancel, and can
restore ref-only history. Draft editing and read-only flight details remain usable.

These additions do not change the 300/315/330-second deadlines, ten-minute terminal
retention or restart limitations. Exact protocol and compatibility are owned by
[RUNTIME_PLAN §5](../design/budget-travel-agent/RUNTIME_PLAN.md); current offline
evidence and runtime gaps are in [progress](../design/budget-travel-agent/progress.md).

### Checks

Check owner isolation, visible running stages before completion, terminal
success/error, deadline/cancellation cleanup and late-response isolation.
Client checks cover transient state, polling recovery and truthful stale
connectivity. Verify the mini-program build and distinguish isolated browser
component checks from WeChat developer-tools or real-device acceptance.

## Limits

The cache needs a shared implementation before multi-instance deployment.
The UI exposes execution activity, not a model's internal chain of thought.
A longer budget does not guarantee completion or provider availability.
