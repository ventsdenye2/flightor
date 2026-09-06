# ADR 0002: Phase 2 cloud state, identity, and ownership boundaries

- Status: Accepted
- Date: 2026-09-06
- Owners: FlightOR architecture and integration owner

## Context

Phase 1 deliberately kept `TripContext` in process and returned fare artifacts
directly to the model. Phase 2 must make authenticated state durable without
breaking the existing `/v1/agent/converse` client-state protocol. The current
identity model stores a WeChat OpenID on `users`, while JWT access tokens already
carry the trusted internal `users.id` in the signed `uid` claim.

## Decisions

### Identity

`users.id` remains the only business ownership key. `users.public_id` remains a
client-safe identifier and provider subjects are stored in `user_identities`.
The identity key is `(provider, provider_subject)`; the first provider is
`wechat`. Existing `users.wechat_openid` values are backfilled and the legacy
column remains temporarily populated so the current login path and deployed
clients continue to work during migration.

WeChat login performs user creation and identity upsert in one transaction.
Repeated login resolves to the same internal user. Request bodies never select
an owner: authenticated routes obtain `userId` only from the verified JWT and
construct user-scoped repositories with it.

### Resource identifiers and authorization

Database relations use bigint internal keys. API, tool, and model boundaries use
UUID public IDs. Repositories are scoped to a trusted internal user ID at
construction time; public resource IDs are only selectors inside that scope.
Missing and foreign resources both produce `RESOURCE_NOT_FOUND`, avoiding an
ownership oracle. UUID entropy is not treated as authorization.

### Aggregate boundaries

- `TripRepository` owns `trips` and immutable `trip_context_versions`.
- `ConversationRepository` owns `conversations` and ordered
  `conversation_messages`; structured tool and artifact references live in
  message metadata rather than being embedded in content.
- `ArtifactRepository` owns relational artifact metadata and versioned JSONB
  payloads. `FlightSearchArtifact` is the first supported payload.
- `UserMemoryRepository` owns one Markdown document per user. Markdown is the
  authority; structured profiles may only be derived caches in a later phase.

Repositories expose in-memory implementations for contract and Agent tests and
PostgreSQL implementations for production. They do not call each other through
HTTP.

### Transactions and optimistic concurrency

Creating a trip inserts the aggregate row and version-zero context snapshot in
one transaction. Updating a context locks the owned trip row, compares
`expectedVersion`, inserts exactly one immutable snapshot, and advances the
aggregate pointer in the same transaction. A stale write raises
`TRIP_CONTEXT_VERSION_CONFLICT`; omission of `expectedVersion` is permitted only
for the Phase 1 compatibility interface, not public cloud mutation APIs.

Memory content and enabled-state writes require `expectedVersion`. Each accepted
write increments `version`; stale writes raise `USER_MEMORY_VERSION_CONFLICT`.
Disabling memory retains Markdown but prevents Planner reads and automatic Agent
writes. The Markdown UTF-8 limit is 8 KiB.

Artifact creation validates ownership of the trip and optional conversation in
the same transaction. Conversation creation and message append validate the
owned trip/conversation before writing. No cross-domain write is silently
partially committed.

### Agent integration

The Planner receives a user-scoped repository bundle. `search_flights` persists
the full `FlightSearchArtifact`, while its tool result contains only an artifact
reference and compact summary. Enabled Memory may be injected; disabled Memory
is neither returned to the Planner nor writable by Agent tools. Conversation
messages and artifact references are persisted around an Agent run.

The existing `/v1/agent/converse` remains unchanged. A temporary authenticated
cloud-runtime route may prove the new path; it is a migration seam, not a second
permanent product API.

Phase 2 exposes these authenticated contracts:

- `POST /v1/trips`, `GET /v1/trips/:id`, and
  `PUT /v1/trips/:tripId/context`;
- `POST /v1/conversations`, `GET /v1/conversations/:conversationId`, and
  `GET /v1/conversations/:conversationId/messages`;
- `GET /v1/artifacts/:id`;
- `GET /v1/memory`, `PUT /v1/memory`, and
  `PATCH /v1/memory/settings`; and
- temporary `POST /v1/agent-v2/converse` for the authenticated cloud-runtime
  vertical slice.

Every mutation contract carrying versioned state requires `expected_version`.
Request schemas are strict and reject client-supplied ownership fields.

### Research Agent seam

Planner is the sole user-facing Agent. `ResearchAgent.research` accepts a
minimal `ResearchBrief` plus execution context and returns a
`ResearchArtifact`. It cannot access or mutate User Memory, Trip Context, route
optimization, or structured flight/location tools. Phase 2 provides only the
types, deterministic mock, and contract tests.

## Migration sequence

1. Create `user_identities` and backfill existing WeChat identities.
2. Create trips and immutable context versions.
3. Create conversations/messages, artifacts, and user memories with ownership
   indexes and constraints.
4. Backfill one enabled, empty memory row for each existing user.
5. Deploy dual-write WeChat login to `users.wechat_openid` and
   `user_identities` before any later removal of the legacy column.

The migration down path drops only Phase 2 tables in dependency order and does
not delete or rewrite existing users.

## Consequences

The old and new Agent paths can coexist while tests mature. Provider-neutral
identity is available without a destructive key migration. PostgreSQL row locks
serialize concurrent Trip and Memory writes, while explicit versions make lost
updates visible. The temporary legacy OpenID column and temporary cloud Agent
route must be retired by later, separately reviewed migrations.
