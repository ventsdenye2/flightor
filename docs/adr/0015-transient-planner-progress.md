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

Check owner isolation, visible running stages before completion, terminal
success/error, deadline/cancellation cleanup and late-response isolation.
Client checks cover transient state, polling recovery and truthful stale
connectivity. Verify the mini-program build and distinguish isolated browser
component checks from WeChat developer-tools or real-device acceptance.

## Limits

The cache needs a shared implementation before multi-instance deployment.
The UI exposes execution activity, not a model's internal chain of thought.
A longer budget does not guarantee completion or provider availability.
