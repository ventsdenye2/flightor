# ADR 0017 — Inclusive Trip dates and duration consistency

Status: accepted for implementation, 2026-09-13.

## Decision

The current Trip model has one calendar span. Departure and return windows are
inclusive bounds on its first and last day; `travelDays` counts both endpoints.
It does not model nights, arrival time zones, or separate transport and visit
spans. Those require explicit future contracts, not inferred extra days.
An `exact` window identifies one date: if both bounds are present they must be
equal; one bound identifies that exact date. `approximate` admits a range of
possible dates. Copying the whole trip span into an exact departure window is
invalid (the observed saved failure had departure October 12–13, return 14).

The Planner still extracts user intent. A shared Trip domain check rejects a
merged snapshot when no departure/return pair can satisfy its dates and duration.
For exact dates, October 12–13 is two days; October 12–14 is three. Flexible and
one-sided windows remain valid when a feasible pair exists. Missing facts remain
missing. The server never silently changes a date or duration to resolve conflict.
When both endpoints identify fixed dates and travelDays is absent, planning and
coverage validation derive their inclusive count without writing a missing Trip
field. Research bounds come from the feasible date interval; unknown bounds stay
absent rather than being replaced by the other endpoint.

Creation and sparse updates validate before persistence and return
`TRIP_DATES_INCONSISTENT` with structured fields. Rejected writes consume no
context version. Research-window construction and day planning use the same
check before external work; guide pre-save and completion validation reject
historical inconsistent snapshots as `trip_dates_inconsistent`.

Historical snapshots remain readable and are not rewritten. The UI continues
to show persisted facts. A correction is an explicit new context version and
new immutable artifacts under the existing workspace/Goal rules.

## Limits and validation

Consistency is not semantic proof of the original message: mutually consistent
but wrongly extracted dates still need user correction. Offline regression covers
inclusive endpoints, flexible/partial windows, sparse updates, no-write failures,
month/leap-year boundaries, and previously saved conflicting guide inputs.
Live Planner acceptance and WeChat device evidence remain separate.
