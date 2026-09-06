# FlightOR Agent Architecture v1

> Status: **Product + engineering baseline**
>
> Purpose: This document is the authoritative design contract for the next major iteration of FlightOR.
> All future Agent, backend, provider, route-planning, discovery, admin, and frontend work should follow this document unless a later architecture decision explicitly supersedes it.
>
> Guiding idea:
>
> **LLM understands and decides. Tools provide facts and computation. FlightOR owns route intelligence. The UI renders structured artifacts, not only text.**

---

## 0. Executive Summary

FlightOR is a travel-planning product focused on two simultaneous goals:

1. Design routes that are **interesting, playable, and personalized**.
2. Use flexible dates, creative stopovers, self-transfer opportunities, and route ordering to **reduce airfare as much as reasonably possible**.

The new product is **Agent-first**, but not “LLM-does-everything”.

The system should be divided into clear responsibility boundaries:

```text
User
  │
  ▼
FlightOR Agent (LLM)
  │
  ├─ understands intent
  ├─ decides what information is missing
  ├─ chooses tools
  ├─ discusses options with the user
  └─ explains recommendations
  │
  ▼
Tool Runtime
  │
  ├─ validates arguments
  ├─ applies permissions / budgets / rate limits
  ├─ executes deterministic domain services
  └─ returns structured artifacts
  │
  ▼
FlightOR Domain Services
  │
  ├─ Aviation / topology
  ├─ Fare search
  ├─ Destination research
  ├─ Connection engine
  ├─ Route planner
  ├─ Route optimizer
  ├─ Memory
  └─ Discovery
  │
  ▼
Providers
  ├─ AeroDataBox — primary aviation data
  ├─ SerpApi / Google Flights — primary fare data
  ├─ Web research — events / destination information
  └─ OAG — optional aviation enhancement/fallback, never a hard dependency
```

The current rule-first extraction pipeline must be replaced. Business-language regexes must **not** be the primary interpreter of user intent.

---

# 1. Product Principles

## 1.1 Agent owns semantic understanding

The Agent receives the user conversation directly and decides what the user means.

Do **not** pre-parse user messages using business regexes such as:

- “北京” → PEK
- “一万五” → 15000
- “动漫” → culture
- “日本” → japan

before the LLM is allowed to reason.

Instead:

- LLM understands that “北京” is an origin concept.
- LLM calls `resolve_location`.
- LLM understands that “一万五” is a budget.
- LLM calls `update_trip_context`.
- LLM understands that the user wants destination ideas.
- LLM calls `recommend_destinations`.

Deterministic code still validates tool arguments and provider results.

### Rule

> **Remove semantic authority from regex parsing; retain deterministic schema, domain and safety validation.**

---

## 1.2 Tools own facts and computation

The LLM must never invent:

- airport identifiers;
- whether a route exists;
- scheduled flight availability;
- current airfare;
- actual flight times;
- event dates;
- airport coordinates;
- route scores;
- saved user memory state.

Facts must come from tools/providers or verified internal data.

---

## 1.3 FlightOR owns route intelligence

AeroDataBox, SerpApi and other providers provide data.

They do **not** define the product.

FlightOR should own:

- preferred-city-aware connection discovery;
- creative stopover generation;
- self-transfer policy;
- route permutation/search;
- experience scoring;
- price-vs-effort scoring;
- Pareto filtering;
- route representative selection;
- explanations.

This is the primary product moat.

---

## 1.4 User remains in control

The Agent can proactively suggest destinations, stopovers and alternate routes.

However:

- user corrections immediately override prior assumptions;
- long-term Memory is a soft preference, never a hard trip constraint;
- the current trip always takes priority over Memory;
- the user decides when to generate routes;
- the user decides what route to use;
- FlightOR does not purchase or book tickets.

---

# 2. Core Product Flow

The main planning flow is:

```text
Conversation starts
      │
      ▼
Load optional User Memory
      │
      ▼
User discusses trip with Agent
      │
      ├─ Agent can search the web
      ├─ Agent can research events
      ├─ Agent can search flights
      ├─ Agent can recommend destinations
      └─ Agent updates Trip Context
      │
      ▼
User decides information is sufficient
      │
      ▼
User presses "Generate Route"
      │
      ▼
Route Generation
      │
      ├─ destination candidates
      ├─ preferred-city candidates
      ├─ topology search
      ├─ flight/fare search
      ├─ stopover exploration
      ├─ route construction
      └─ multi-objective optimization
      │
      ▼
Distinct Route Artifacts
      │
      ├─ Cheapest
      ├─ Balanced
      ├─ Most Fun
      └─ Best Match
      │
      ▼
Visual Route Workspace
      │
      ├─ map
      ├─ timeline
      ├─ activities
      ├─ flights
      ├─ cost
      └─ explanation
      │
      ▼
User can return to Agent and revise
```

### Minimum requirements before "Generate Route"

The button is enabled only when the system has:

1. origin;
2. approximate departure time/window.

Everything else may be unknown.

The Agent may generate reasonable candidate routes from incomplete requirements and should explicitly communicate assumptions when relevant.

---

# 3. State Model

Four state domains must remain separate.

```text
User Memory
= long-term preferences of the person

Conversation
= natural-language interaction history

Trip Context
= constraints and preferences for this trip

Artifacts
= structured outputs produced during this trip
```

Do not merge them into one giant `TripState`.

---

# 4. User Memory

## 4.1 Product behavior

Memory is:

- optional;
- cloud-hosted;
- bound to the user account, not a device;
- available to WeChat mini-program and future web frontend;
- user-visible;
- user-editable;
- user-deletable;
- stored primarily as Markdown.

A user can turn Memory off.

When disabled:

- Agent must not load the memory;
- Agent must not write the memory;
- memory content must not be injected into LLM context.

---

## 4.2 Markdown is the source of truth

Example:

```md
# 我的旅行偏好

## 常用出发地
- 北京

## 偏好城市
- 东京
- 首尔
- 新加坡

## 兴趣
- 动漫
- 美食
- 摄影
- 城市漫游

## 旅行风格
- 比较在意机票价格
- 可以接受多城市路线
- 可以接受长时间中转，如果中转城市值得玩
- 不喜欢为了很少的价格差增加大量折腾

## 航班偏好
- 可以接受廉航
- 可以接受 self-transfer，但希望留足时间
```

The user may freely edit the Markdown.

A structured runtime profile may be generated from the Markdown for efficient scoring, but:

> **Markdown remains authoritative. The structured profile is derived cache only.**

---

## 4.3 Memory write policy

Automatically save only **clear long-term preferences**.

Examples allowed:

- “以后转机可以优先考虑首尔。”
- “我一般比较看重价格。”
- “我一直很喜欢动漫和摄影。”
- “我可以接受 self-transfer。”

Do not automatically save:

- “这次预算 8000。”
- “国庆想去法国。”
- “这次不想坐廉航。”
- “东京还挺好玩的。”

Ambiguous inference must not modify Memory.

---

## 4.4 Priority order

```text
Current explicit user message
        >
Current Trip Context
        >
User Memory
        >
FlightOR defaults
```

Example:

Memory:

```text
喜欢东京
```

Current trip:

```text
这次不要经过日本
```

Japan must be excluded.

---

## 4.5 Persistence model

Recommended tables:

```text
user_memories
- user_id
- enabled
- markdown
- version
- parse_version
- updated_at

user_memory_profiles
- user_id
- memory_version
- parsed_json
- updated_at
```

Use optimistic concurrency:

```text
expected_version
```

Memory edits must fail with a version conflict rather than silently overwrite a newer edit.

---

# 5. Identity and Multi-device Design

One WeChat user currently maps to one FlightOR user account and one Memory.

However, identity must be designed for future web login.

Recommended model:

```text
users
user_identities
```

Example identities:

```text
wechat_openid
email
future_oauth_provider
```

The domain model uses internal `user_id`.

Never use WeChat OpenID as the universal primary key throughout the application.

Cloud persistence should eventually include:

- Memory;
- conversations;
- trips;
- route artifacts;
- saved routes;
- alerts.

Local storage may remain as a cache/offline convenience, never as authoritative long-term user state.

---

# 6. Trip Context

`TripContext` is the current trip state.

Recommended shape:

```ts
interface TripContext {
  id: string

  origin?: LocationRef

  departureWindow?: {
    from?: string
    to?: string
    precision: 'exact' | 'approximate'
  }

  returnWindow?: {
    from?: string
    to?: string
    precision: 'exact' | 'approximate'
  }

  travelDays?: number

  budget?: {
    amount: number
    currency: string
    scope: 'airfare' | 'transport' | 'trip'
  }

  destinationIntent: {
    mode: 'explicit' | 'open' | 'mixed'
    required: LocationRef[]
    preferred: LocationRef[]
    excluded: LocationRef[]
  }

  interests: string[]

  pace?: 'relaxed' | 'balanced' | 'intensive'

  priorities: {
    price?: number
    comfort?: number
    experience?: number
    simplicity?: number
  }

  transferPreferences: {
    acceptsSelfTransfer?: boolean
    acceptsLongStopover?: boolean
    acceptsAirportChange?: boolean
  }

  locationRoleOverrides: Array<{
    location: LocationRef
    role: 'visit' | 'stopover_only' | 'avoid'
  }>

  mustIncludeEvents: ActivityRef[]

  notes: string[]

  version: number
}
```

### Important

Do not force the user to understand separate “preferred destination” and “preferred stopover” settings.

A long-term preferred city influences both.

The current trip may override its role:

```text
东京只想中转，不想正式玩
```

becomes a trip-local `stopover_only` override.

---

# 7. Artifacts

Agent tools should produce structured artifacts rather than only text.

Core artifact types:

```text
ResearchArtifact
ActivityArtifact
FlightSearchArtifact
DestinationSetArtifact
RouteSetArtifact
RouteArtifact
TravelGuideArtifact
```

Artifacts should:

- have stable IDs;
- be stored separately from chat text;
- be renderable by multiple clients;
- contain verification metadata;
- be referenceable by later tool calls;
- avoid flooding LLM context with huge JSON payloads.

Example:

```text
route_set_id = rs_xxx
```

The Agent receives compact summaries and IDs.

The frontend fetches full artifact detail when needed.

---

# 8. Agent Runtime

## 8.1 Standard loop

```ts
for step in 0..MAX_STEPS {
  response = LLM(messages, tools)

  if response has no tool calls:
    return final response

  execute tool calls
  append tool results
}
```

### Required protections

- maximum tool steps;
- maximum provider cost per turn;
- request timeout;
- retry policy by provider;
- tool argument schema validation;
- tool-specific permission policy;
- tool execution tracing;
- cancellation / generation ID;
- deterministic fallback response.

---

## 8.2 Tool call concurrency

Parallelize only independent calls.

Examples:

Safe:

```text
resolve Tokyo
resolve Seoul
```

Potentially parallel:

```text
search PEK → NRT
search PEK → KIX
```

Do not parallelize state mutations that may conflict.

---

## 8.3 Tool composition rule

Agent-facing tools should not recursively call other Agent-facing tools.

Instead:

```text
Agent Tool
   ↓
Domain Service
   ↓
Provider / algorithm services
```

A high-level tool such as `search_connection_flights` may internally call domain services that also power `search_flights`, but should not invoke another tool through the Agent runtime.

This keeps execution deterministic and testable.

---

## 8.4 Planner Agent and delegated Research Agent

FlightOR exposes one user-facing Agent, not several peer Agents.

```text
User
  │
  ▼
Planner Agent
  │
  ├──────────────┐
  ▼              ▼
Research Agent   Structured Tools
  │              │
  ▼              ├─ Location
ResearchArtifact ├─ Flight
                 ├─ Memory
                 └─ Trip Context
        \          /
         \        /
          ▼      ▼
       FlightOR Engine
       ├─ Connection
       ├─ Path Search
       └─ Optimizer
```

### Planner Agent

The Planner Agent is the only Agent that talks directly to the user. It:

- understands user intent and manages the conversation;
- reads and updates Trip Context;
- reads enabled User Memory and updates it only for clear long-term
  preferences;
- decides when open-world research is needed;
- delegates a minimal brief to the Research Agent;
- calls structured location, flight, Memory and Trip Context tools;
- requests deterministic route-engine work;
- combines Artifact references; and
- explains recommendations to the user.

The Planner Agent has only the access it needs to the active user's
Conversation, Trip Context, enabled Memory and Artifacts. Access is always
enforced by server-side ownership checks; model-supplied user or resource IDs
are never authority.

### Research Agent

The Research Agent is a restricted sub-Agent scheduled by the Planner Agent.
It handles open-world travel research such as current events, exhibitions,
festivals, seasonal conditions, current destination and stopover activities,
dynamic opening information, and time-window-specific opportunities.

It receives only the minimum context required for the research task and does
not inherit the complete Conversation. Its sole product output is a verified
`ResearchArtifact`.

```ts
interface ResearchBrief {
  destinations: LocationRef[]
  travelWindow?: {
    from?: string
    to?: string
  }
  interests: string[]
  questions: string[]
  researchTypes: Array<
    | 'event'
    | 'seasonal'
    | 'activity'
    | 'stopover'
    | 'practical'
  >
  maxResults?: number
}
```

The Research Agent must not:

- modify User Memory or Trip Context;
- decide the final route or run route optimization;
- own long-term user state;
- turn research findings into required destinations or required events; or
- perform structured aviation/fare queries.

`resolve_location`, `search_flights`, and `search_flexible_flights` remain
Planner-owned structured tools. Route generation remains deterministic:

```text
Planner Agent
      ↓
FlightOR deterministic engine
      ↓
Connection Engine
Route Planner
Route Optimizer
```

The Planner decides how, or whether, a `ResearchArtifact` should influence the
active trip.

---

# 9. Agent-facing Tool Set v1

The repository must maintain a root-level `TOOLS.md`.

Every Agent-facing tool must document:

- purpose;
- input schema;
- output schema;
- cost class;
- side effects;
- authority;
- provider dependencies;
- caching;
- failure behavior;
- implementation status.

## 9.1 Context / Memory

### `get_trip_context`

Read current trip state.

### `update_trip_context`

Apply explicit user constraints/preferences to current trip.

Cost: free
Side effect: state mutation
Authority: user-derived

### `get_user_memory`

Return Memory Markdown and version when enabled.

### `update_user_memory`

Update only clear long-term preferences.

Must use optimistic versioning.

### `delete_user_memory`

User-directed memory deletion/reset operation.

---

## 9.2 Geography / Destinations

### `resolve_location`

Resolve natural-language location into canonical city/airport references.

### `search_destinations`

Search destination candidates matching region, interests or accessibility.

### `recommend_destinations`

Generate scored destination recommendations using:

- Trip Context;
- Memory;
- season/time;
- origin accessibility;
- curated destination data.

---

## 9.3 Flight / Fare

### `search_flights`

Search real flight/fare options for one requested leg.

### `search_flexible_flights`

Search date-flexible options inside a date window.

### `search_connection_flights`

FlightOR connection discovery tool.

Responsibilities:

- preferred-city-first candidate exploration;
- general hub graph exploration;
- traditional itinerary candidates;
- self-transfer candidates;
- stopover candidates;
- route/fare evaluation.

This is a FlightOR domain tool, not a wrapper around one provider API.

### `confirm_flight_price`

Refresh/verify one selected flight option.

### `confirm_route_price`

Refresh/verify the fare-critical legs of a selected route.

---

## 9.4 Route Planning

### `plan_trip_route`

Create a travel-experience structure:

- cities;
- visit duration;
- activities;
- land transfers;
- day allocation.

Does not own global flight optimization.

### `plan_flight_route`

Generate complete flight path candidates across trip cities.

Conceptually:

```text
Edge candidates → complete paths
```

### `optimize_route`

Rank/filter complete route candidates.

Conceptually:

```text
Complete paths → Pareto frontier → representative routes
```

Does not discover flights itself.

---

## 9.5 Research

### `web_research`

General internet research for the active conversation.

Used for:

- current events;
- exhibitions;
- festivals;
- seasonal conditions;
- destination questions.

### `research_destination`

Structured destination research.

### `build_travel_guide`

Build a day-level guide from verified research and a route.

---

# 10. Provider Architecture

## 10.1 Primary provider strategy

```text
AeroDataBox
= primary aviation data

SerpApi / Google Flights
= primary fare data

FlightOR
= connection + route intelligence

OAG
= optional enhancement / fallback
```

FlightOR core functionality must remain usable with OAG credentials removed.

---

## 10.2 Aviation Provider

```ts
interface AviationProvider {
  resolveLocation(...)
  getAirport(...)
  getAirportRoutes(...)
  getSchedules(...)
  getFlightStatus(...)
}
```

Implementations:

```text
AeroDataBoxProvider — primary
OagProvider — optional
MockAviationProvider — tests
```

Do not let Agent tools depend directly on AeroDataBox-specific response shapes.

Normalize at provider boundary.

---

## 10.3 Fare Provider

```ts
interface FareProvider {
  searchFlights(...)
  searchFlexibleFlights(...)
  refreshFlight(...)
}
```

Implementations:

```text
SerpApiFareProvider
MockFareProvider
```

Fare data is time-sensitive and requires `checkedAt`.

---

## 10.4 AeroDataBox usage

Initial required capability families:

1. airport search/details;
2. airport route statistics / route graph;
3. schedules / airport departures-arrivals;
4. flight status.

Do not initially spend effort integrating unrelated aircraft/fleet/runway APIs.

### Subscription strategy

Development:

```text
Trial / Starter
```

Production topology/cache requirements should be reviewed against AeroDataBox retention/caching license terms before launch.

---

# 11. Connection Engine

This is a core FlightOR domain.

Concept:

```text
search_connection_flights
= Edge Search
```

Input:

- origin;
- destination;
- date window;
- Trip Context;
- preferred cities from Memory;
- trip-local location role overrides;
- self-transfer preference;
- stopover preference.

---

## 11.1 Candidate search order

### Stage A — preferred-city-first

Example:

```text
PEK → CDG
preferred cities:
Tokyo
Seoul
Singapore
```

Test:

```text
PEK → TYO → PAR
PEK → SEL → PAR
PEK → SIN → PAR
```

Preferred cities receive a bonus, not exclusivity.

### Stage B — topology expansion

Explore strong hub candidates from local route graph.

### Stage C — schedule feasibility

Verify that relevant legs exist for the time window.

### Stage D — fare search

Query real fares only for sufficiently promising candidates.

This is essential for controlling provider cost.

---

## 11.2 Stopover behavior

FlightOR should actively support:

- long layovers;
- one-day stopovers;
- one-to-two-night stopovers;
- preferred-city stopovers.

Stopover is a feature, not an error case.

---

## 11.3 Self-transfer

Self-transfer is allowed.

It must:

- be clearly labeled;
- receive a risk penalty;
- use conservative timing buffers;
- warn about baggage/re-check/security risks;
- never be described as protected connection unless the provider explicitly indicates it.

Recommended configurable defaults:

```text
same-airport self-transfer minimum buffer: 8h
airport-change minimum buffer: 12h
playable stopover threshold: 10h
strong stopover threshold: 18h
```

These are product defaults, not legal/airline guarantees.

Store them in configuration, not hardcoded across UI code.

---

## 11.4 Airport changes

Allowed.

Examples:

- NRT → HND
- LHR → LGW

Apply:

- additional time/risk penalty;
- explicit visual indicator;
- larger buffer.

---

# 12. Flight Route Planner

Concept:

```text
plan_flight_route
= Path Search
```

It receives:

- trip city candidates;
- required cities;
- optional cities;
- route graph;
- candidate flight edges;
- date constraints;
- trip duration.

It generates complete candidate paths.

The LLM must not brute-force city permutations via repeated tool calls.

The planner handles search internally using deterministic algorithms.

Possible strategies:

- bounded DFS / beam search;
- branch-and-bound;
- heuristic pruning;
- cached graph edges;
- hard constraints first, soft scoring later.

Search space must be bounded.

---

# 13. Route Optimizer

Concept:

```text
optimize_route
= Path Ranking
```

It does not:

- discover new flights;
- invent new cities;
- call providers.

It evaluates existing complete candidates.

---

## 13.1 Score components

Recommended normalized dimensions:

### Positive

```text
airfareSaving
preferredCityMatch
interestMatch
eventMatch
seasonMatch
stopoverPlayability
additionalCityValue
routeNovelty
```

### Negative

```text
totalTravelTime
transferCount
selfTransferRisk
airportChangePenalty
backtrackingPenalty
deadTimePenalty
excessiveComplexity
```

---

## 13.2 User-specific weights

Weights derive from:

1. explicit current trip preferences;
2. Memory;
3. FlightOR defaults.

The user does not need to manually configure numeric weights.

The Agent translates natural-language preferences into scoring priorities.

---

## 13.3 Pareto frontier

Do not collapse every candidate into only one opaque scalar score.

Use:

1. hard validation;
2. Pareto filtering;
3. weighted scoring inside the remaining set;
4. representative-route selection.

Representative labels:

```text
Cheapest
Balanced
Most Fun
Best Match
```

Do not force four distinct routes.

If one route wins multiple categories:

```text
Balanced · Best Match
```

Use one route with multiple badges.

---

# 14. "Fun" Route Definition

“Fun” is user-relative.

Possible positive features:

- matching interest cities;
- matching preferred cities;
- meaningful stopover;
- current event match;
- seasonal relevance;
- adding a worthwhile city;
- interesting mixed transport;
- reducing backtracking;
- good ratio of travel time to experience.

Do not define “fun” as simply “more cities”.

Too many cities can reduce the score for relaxed users.

---

# 15. Visa / Entry Policy

v1 does **not** claim legal immigration eligibility.

Always treat visa/entry information as informational only.

Product-level disclaimer:

> **签证、过境及入境条件可能因护照、行程和政策变化而不同，请在出行前自行确认最新要求。**

The Agent must not make definitive claims such as:

```text
你一定可以免签进入韩国
```

even if research suggests it.

---

# 16. Research and Verification

Users do not need raw source/provider names in ordinary route UI.

However, all externally derived facts must keep internal provenance.

---

## 16.1 Verification record

```ts
interface VerificationRecord {
  status: 'verified' | 'partially_verified' | 'stale' | 'unverified'
  checkedAt: string
  expiresAt?: string
  confidence: number
  sources: SourceRecord[]
}
```

---

## 16.2 Event source priority

Preferred source order:

1. official event website;
2. official organizer;
3. government/tourism board;
4. official venue;
5. reliable media;
6. travel/content websites.

Important event dates should normally have:

- one authoritative official source; or
- multiple independent supporting sources.

---

## 16.3 Fare verification

Fare artifacts must include internally:

```text
checkedAt
provider
currency
query parameters
```

The frontend may show a user-friendly “updated recently” label without exposing provider implementation.

---

# 17. Route Visual Design

Route output is not a wall of text.

The route detail experience must use:

```text
Route Hero
+
Interactive Map
+
Timeline
+
Activities
+
Flights / Cost
+
Why this route
```

---

## 17.1 Route Hero

Show:

- trip title;
- date/duration;
- city sequence;
- estimated airfare/transport;
- savings estimate where meaningful;
- representative badges.

Example:

```text
日本 + 韩国 · 9日

北京 → 大阪 → 京都 → 东京 → 首尔 → 北京

预计机票 ¥4,280
综合最佳 · 最符合偏好
```

---

## 17.2 Interactive route map

Map displays:

- visit cities;
- stopover cities;
- airports;
- flight edges;
- rail/ground edges;
- activity markers;
- preferred-city indicator;
- airport-change indicator.

Clicking a city opens:

- stay duration;
- activities;
- why selected;
- next segment.

Clicking an edge opens:

- transport type;
- duration;
- estimated/current fare;
- flight options.

The map must be functional navigation, not decorative.

---

## 17.3 Timeline

Answer:

```text
每天怎么玩？
```

Timeline includes:

- day;
- city;
- flight/rail movements;
- selected activities;
- user-required events;
- stopover play windows.

---

## 17.4 Cost / flight section

Show leg-level airfare options.

Each leg can open the Flight Explorer.

---

## 17.5 Why this route

Explain concrete optimizer reasons:

```text
✓ 比传统方案预计便宜 ¥X
✓ 命中你喜欢的东京和首尔
✓ 首尔停留时间适合游玩
✓ 活动时间与出行日期匹配
✓ 大阪进、东京出减少回头路
```

This explanation should be based on optimizer/artifact data, not invented post-hoc by the LLM.

---

# 18. Flight Search Product Integration

Do **not** remove the existing flight-search capability.

Instead, remove it as an isolated primary product silo.

Flight search becomes:

1. an Agent tool;
2. a quick structured action inside Plan;
3. a detailed subpage named Flight Explorer;
4. a leg-detail tool from Route Detail.

---

## 18.1 One unified flight artifact

Both:

```text
User manually opens "Search Flights"
```

and:

```text
Agent calls search_flights
```

must produce the same:

```text
FlightSearchArtifact
```

Do not maintain two search implementations.

---

## 18.2 Flight Explorer

Reuse useful concepts from the existing SearchPage:

- direct / airline-transfer / self-transfer;
- recommended / price / duration sorting;
- flexible-date price matrix;
- map;
- risk warnings;
- alternate origin/destination airport;
- route details.

Flight Explorer is a subpage, not a main Tab.

---

# 19. Frontend Information Architecture

Primary tabs:

```text
Plan
Explore
Trips
Profile
```

`Plan` remains the primary default entry for v1.

---

## 19.1 Plan — Trip Workspace

Contains:

- current Trip Context chips;
- Agent conversation;
- embedded research cards;
- embedded activity cards;
- embedded flight-search cards;
- route preview/draft;
- quick actions;
- Generate Route button.

The full structured context is secondary, not the visual center.

---

## 19.2 Explore — Discovery Feed

Content categories:

```text
event
seasonal
theme
stopover
deal
```

Feed ranking considers:

```text
content quality
freshness
Memory match
origin accessibility
fare attractiveness
novelty
```

Clicking a content card creates a `TripSeed`.

The template is adapted to the user rather than copied blindly.

---

## 19.3 Trips

Cloud-backed trip history:

- currently planning;
- generated;
- saved;
- archived.

Routes and conversations remain associated with the same Trip.

---

## 19.4 Profile

Contains:

- account;
- Memory on/off;
- Memory Markdown editor;
- saved routes;
- alerts;
- settings;
- data controls.

Existing local `TOGO` should be migrated into Memory preferences rather than remain a separate long-term preference subsystem.

---

# 20. Explore Discovery System

Explore content is produced by:

```text
Automatic discovery
      ↓
Deduplication + verification
      ↓
LLM draft generation
      ↓
Human review
      ↓
Publish
```

AI must not auto-publish v1 content.

---

## 20.1 Content types

```text
Event
Seasonal
Theme
Stopover
Deal
```

---

## 20.2 Discovery lifecycle

```text
candidate
→ draft
→ review
→ published
→ stale
→ expired / archived
```

Time-sensitive items must automatically become stale/expired.

---

## 20.3 TripTemplate

Explore content may reference a curated `TripTemplate`.

A TripTemplate contains:

- route concept;
- anchor destinations;
- optional destinations;
- recommended stopovers;
- suggested duration;
- interests;
- experience goals;
- valid time window;
- source/verification metadata.

It must **not** permanently store final airfare or fixed real-time flights.

---

## 20.4 Clicking Explore content

```text
Explore Content
      ↓
TripTemplate
      ↓
TripSeed
      ↓
User Memory + current context
      ↓
Agent Workspace
      ↓
Generate Route
```

The final route is recalculated using current flight/fare data.

---

# 21. Admin Web App

Create:

```text
apps/admin/
```

Recommended stack:

```text
React
Vite
TypeScript
React Router
TanStack Query
lightweight component system
```

Do not use Next.js for this internal SPA unless later requirements justify it.

---

## 21.1 Admin v1 pages

### Dashboard

- pending review;
- newly discovered;
- soon-to-expire;
- provider/discovery failures;
- published templates.

### Review Queue

Filter by:

- content type;
- status;
- freshness;
- quality.

### Template Editor

Edit:

- title;
- summary;
- destination set;
- tags;
- duration;
- route concept;
- stopover ideas;
- source facts;
- validity window.

Show preview.

### Published

- edit;
- unpublish;
- reverify;
- regenerate;
- archive.

### Discovery Monitor

Show:

- last run;
- candidates found;
- errors;
- retry action.

---

## 21.2 Human review actions

```text
Save
Approve & Publish
Regenerate with Instruction
Reject
```

---

## 21.3 Versioning

Use immutable template versions.

Recommended:

```text
trip_templates
trip_template_versions
```

Every:

- AI generation;
- human edit;
- regeneration;
- publication

creates/records a version.

---

# 22. Backend Domain Layout

Target direction:

```text
backend/src/
├── agent/
│   ├── runtime/
│   ├── tools/
│   ├── prompts/
│   └── types/
│
├── memory/
├── trips/
├── artifacts/
├── aviation/
│   ├── providers/
│   ├── topology/
│   └── services/
│
├── fares/
│   ├── providers/
│   └── services/
│
├── destinations/
├── routing/
│   ├── connections/
│   ├── planner/
│   └── optimizer/
│
├── research/
├── discovery/
│   ├── sources/
│   ├── jobs/
│   ├── candidates/
│   ├── templates/
│   ├── review/
│   └── ranking/
│
├── auth/
├── db/
├── routes/
└── app/
```

Do not perform a destructive “move everything at once” refactor.

Migrate domain by domain.

---

# 23. Frontend Migration Strategy

Current WeChat frontend remains under `src/` during the first backend/Agent migration.

Do **not** immediately move the entire mini-program into `apps/weapp`.

Reason:

- unnecessary file churn;
- harder review;
- merge risk;
- harder regression tracking.

First:

1. stabilize backend contracts;
2. introduce Artifact rendering;
3. refactor tabs/pages;
4. only later consider monorepo physical relocation.

The admin app may start under `apps/admin/` immediately because it is new.

---

# 24. API Direction

Keep the public Agent entry conceptually unified.

Recommended:

```text
POST /v1/agent/converse
```

Response should evolve away from:

```text
reply + TripState + fixed route fields
```

toward:

```ts
{
  conversationId,
  tripId,

  reply,

  tripContextSummary,

  artifactRefs: [
    {
      id,
      type,
      presentationHint
    }
  ],

  suggestedActions,

  memoryChanged?,

  warnings
}
```

Large artifacts should be fetched by ID.

Examples:

```text
GET /v1/artifacts/:id
GET /v1/trips/:id
GET /v1/trips/:id/routes
GET /v1/memory
PUT /v1/memory
```

Admin APIs stay under:

```text
/v1/admin/*
```

---

# 25. Database Direction

Suggested new domains/tables:

```text
users
user_identities

user_memories
user_memory_profiles

conversations
conversation_messages

trips
trip_context_versions

artifacts
route_sets
routes
route_segments
route_activities
flight_searches

trip_templates
trip_template_versions

discovery_candidates
discovery_runs
discovery_sources

admin_users
admin_roles
```

Do not over-normalize v1 artifact internals if JSONB gives safer iteration speed.

Recommended hybrid:

- relational columns for identity/status/indexing;
- JSONB for rapidly evolving artifact payloads;
- explicit schema validation at application boundary.

---

# 26. Caching and Cost Control

Provider calls are not all equal.

Tool metadata should classify:

```text
free
cheap
paid
expensive
```

Use local/Redis caches aggressively for:

- location resolution;
- airport data;
- route topology;
- schedule discovery;
- research results where appropriate.

Fares require short-lived caching.

### Route generation strategy

Do not query real fare data for every graph edge.

Use:

```text
topology → prune → estimate → shortlist → real fare lookup
```

Provider budget must be bounded per generation request.

---

# 27. Error and Degradation Policy

A mature route must survive partial provider failures.

Examples:

### AeroDataBox unavailable

- use cached topology;
- clearly mark freshness internally;
- continue fare search where possible.

### SerpApi unavailable

- return route concepts with unconfirmed fare state;
- do not fabricate prices.

### Web research unavailable

- route generation still works;
- omit current-event enrichment.

### OAG unavailable

- no impact on core product.

---

# 28. Observability

Every Agent turn should trace:

```text
request_id
conversation_id
trip_id
agent_step
tool_name
tool_duration
tool_result_status
provider
provider_cost_class
artifact_ids
warnings
```

Do not log:

- provider API keys;
- auth tokens;
- private Memory content in ordinary application logs.

---

# 29. Security / Privacy

Memory and trip conversations are private user data.

Requirements:

- authenticated access by `user_id`;
- authorization check on every trip/artifact/memory fetch;
- never use client-provided user IDs as authority;
- redact provider/auth secrets;
- admin and consumer identities are separate;
- admin endpoints require internal roles;
- server-side validation on every tool input.

---

# 30. Testing Strategy

## 30.1 Unit

Test:

- context mutation;
- memory version conflicts;
- location normalization;
- connection scoring;
- self-transfer policy;
- stopover classification;
- Pareto filtering;
- route representative selection;
- source verification;
- provider normalization.

## 30.2 Tool contract tests

Every tool:

- valid input;
- invalid input;
- provider failure;
- empty result;
- timeout;
- deterministic serialization.

## 30.3 Agent scenario tests

Examples:

### Scenario A

```text
十月从北京出发，一周，城市你帮我选
```

Expected:

- origin resolved;
- approximate time stored;
- destination recommendation allowed;
- no regex dependency.

### Scenario B

Memory:

```text
喜欢东京、首尔
```

User:

```text
去巴黎，最好路上还能玩一下
```

Expected:

- preferred hubs explored first;
- general hubs still explored;
- multiple route styles preserved.

### Scenario C

Memory:

```text
喜欢东京
```

User:

```text
这次日本只想中转，不正式玩
```

Expected:

- Tokyo may be stopover;
- Japan must not become primary visit destination.

### Scenario D

User:

```text
这次不要经过日本
```

Expected:

- Memory preference is overridden.

### Scenario E

User asks current event question.

Expected:

- web research;
- verification metadata;
- event not automatically made mandatory until user requests it.

---

## 30.4 Route golden tests

Maintain fixed synthetic graph/fare fixtures.

Golden cases must validate:

- cheapest route;
- preferred-city route;
- stopover route;
- airport-change penalty;
- self-transfer risk;
- backtracking penalty;
- category de-duplication.

---

# 31. Migration From Current Agent

Remove gradually:

```text
rule extraction as semantic authority
LLM delta grounded by regex evidence
hardcoded region-first planning assumptions
```

Retain/reuse where useful:

- Fastify app infrastructure;
- provider adapters that remain useful;
- existing deterministic route engine concepts;
- SerpApi integration;
- route confirmation ideas;
- race/cancellation protections;
- conversation session concepts;
- useful Flight Search UI components;
- risk warnings;
- route visualization components.

Do not delete legacy code before the replacement has tests and a working path.

---

# 32. Implementation Phases

## Phase 0 — Architecture preparation

Deliver:

- this document committed to root;
- root `TOOLS.md`;
- architecture decision notes where needed;
- no destructive frontend refactor yet.

---

## Phase 1 — Agent Runtime + Provider Abstractions

Implement:

- tool-calling-capable OpenRouter client;
- Agent runtime loop;
- Tool Registry;
- `AviationProvider`;
- `FareProvider`;
- AeroDataBox provider;
- SerpApi normalized fare provider;
- OAG optional provider;
- Mock providers.

---

## Phase 2 — Cloud Memory + Trip Domain

Implement:

- `users/user_identities` direction;
- cloud Memory;
- Markdown editor API;
- Memory versioning;
- Trip Context;
- cloud conversations;
- core artifacts.

---

## Phase 3 — Core Tools

Implement first:

```text
get_trip_context
update_trip_context
get_user_memory
update_user_memory
resolve_location
search_flights
search_flexible_flights
search_connection_flights
plan_flight_route
optimize_route
web_research
```

Then:

```text
search_destinations
recommend_destinations
plan_trip_route
confirm_flight_price
confirm_route_price
research_destination
build_travel_guide
```

---

## Phase 4 — Connection / Route Engine

Implement:

- preferred-city-first search;
- general graph search;
- self-transfer;
- stopover;
- airport change;
- bounded path search;
- scoring;
- Pareto frontier;
- representative routes.

---

## Phase 5 — Agent API Migration

Replace old rule-first `conversation-agent` behavior while keeping the public route stable where possible.

Use compatibility adapters temporarily if the old frontend still expects old response fields.

---

## Phase 6 — Plan / Flight UI

Refactor Plan into Trip Workspace.

Integrate:

- Artifact cards;
- flight quick search;
- Generate Route action;
- Flight Explorer subpage.

Do not duplicate search logic.

---

## Phase 7 — Route Visualization

Implement:

- route result list;
- interactive map;
- timeline;
- activity detail;
- flight detail;
- cost section;
- Why This Route.

---

## Phase 8 — Discovery + Admin

Implement:

- discovery jobs;
- candidate lifecycle;
- TripTemplate;
- verification;
- admin SPA;
- review;
- publishing;
- expiry.

---

## Phase 9 — Explore / Trips / Profile

Refactor primary tabs to:

```text
Plan
Explore
Trips
Profile
```

Move:

- TOGO preference → Memory;
- local history → cloud Trips/Conversations where appropriate;
- search page → Flight Explorer subpage.

---

# 33. Definition of Done for v1 Architecture Migration

The architecture migration is considered complete when:

1. Agent can complete a normal planning conversation without rule-first semantic parsing.
2. Agent can call tools through a bounded tool loop.
3. AeroDataBox is the primary aviation provider.
4. Product runs without OAG credentials.
5. SerpApi provides fare search/confirmation.
6. User Memory is cloud-backed Markdown and editable.
7. New conversations inherit Memory when enabled.
8. Current trip overrides Memory.
9. User explicitly triggers route generation.
10. Connection Engine prioritizes preferred cities but still searches alternatives.
11. Self-transfer and long stopovers are supported.
12. Route Optimizer returns distinct representative routes.
13. Route details have map + timeline + activity + flight visualization.
14. Existing flight-search capability survives as Flight Explorer and Agent tool.
15. Explore content is generated by discovery → AI draft → human review → publish.
16. Admin web app can review/edit/publish templates.
17. Important external facts have internal verification/provenance.
18. Visa/entry is never represented as guaranteed legal advice.
19. Core user data is cloud-hosted and future web-client compatible.
20. `TOOLS.md` and this architecture document remain updated as code evolves.

---

# 34. Non-goals for v1

Do not implement yet unless directly required by a current task:

- ticket purchase / booking;
- payment;
- GDS ticketing;
- automatic visa eligibility decisions;
- vector database Memory;
- multiple user personas per account;
- fully autonomous content publication;
- ML-based route ranking;
- native mobile app;
- full monorepo relocation of current mini-program;
- OAG as required production dependency.

---

# 35. Engineering Rules for Codex / Future Contributors

1. Read this document before changing Agent architecture.
2. Update `TOOLS.md` whenever an Agent-facing tool changes.
3. Do not reintroduce regex as the primary semantic parser.
4. Do not allow LLMs to invent provider facts.
5. Do not expose provider-specific schemas beyond provider adapters.
6. Do not duplicate flight-search implementations.
7. Do not mix Memory, Trip Context, Conversation and Artifacts.
8. Do not make OAG a hard dependency.
9. Do not directly publish AI-generated Explore content in v1.
10. Do not perform huge directory moves unless required by the active phase.
11. Prefer small migration-safe commits.
12. Every new route algorithm must have deterministic tests.
13. Every tool must have schema validation and failure tests.
14. Every external factual artifact must carry verification metadata internally.
15. Maintain backwards compatibility temporarily when it materially reduces migration risk.

---

# 36. Product Statement

FlightOR should feel like:

> **A travel Agent that knows what the user likes, discovers timely travel inspiration, searches real flights, finds creative low-cost connections, and turns those facts into routes that are both cheaper and more fun.**

The user should not need to understand airline topology, preferred-stopover settings, provider APIs or optimization weights.

They should simply be able to say:

> “十月从北京出发，我有一周，预算别太高，喜欢动漫和吃东西，路上如果能顺便玩一个我喜欢的城市更好。”

FlightOR should be able to understand that request, research current opportunities, discuss options, and—when the user presses **Generate Route**—produce multiple high-quality, visual, explainable route choices.
