# Phase 6 Plan and Flight Workspace Design System

> Visual direction update (2026-09-13): the user accepted the ocean-teal and white
> UI Experience v1 direction for subsequent new and redesigned user-facing screens.
> Use [the shared visual baseline](./ui-experience-v1.md) for that work. The tokens
> below document the existing Phase 6 appearance; migration is incremental.

This inventory locks the visual and interaction system for Phase 6. Reference
concepts:

- `phase6-plan-workspace-concept.png`
- `phase6-flight-explorer-concept.png`

The images describe hierarchy and density, not sample production data. Example
prices, airports, dates, activities, and verification labels in the concepts
must never appear unless returned by a current Artifact.

## Direction

FlightOR is a calm night-flight operations workspace: near-black open rails,
cool navy surfaces, precise blue actions, restrained cyan structure, and amber
only for risk or incomplete evidence. Cards should feel purposeful rather than
decorative. The visual hierarchy is title, state, evidence, then action.

## Tokens

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--color-bg-primary` | `#000000` |
| Raised card | `--color-bg-card` | `#111923` target, compatible with current `#1c1c1e` migration |
| Filled control | `--color-bg-panel` | `#1b2633` target |
| Hairline | `--color-bg-border` | `rgba(132, 159, 188, 0.24)` target |
| Primary action | `--color-accent-cyan` | `#0a84ff` |
| Structural accent | new `--color-accent-teal` | `#45c6cb` |
| Warning | `--color-warning` | `#ff9f0a` |
| Success | `--color-success` | `#30d158` |
| Primary text | `--color-text-primary` | `#ffffff` |
| Secondary text | `--color-text-secondary` | `rgba(235, 235, 245, 0.68)` target |

Spacing stays on the existing 8rpx base. Main page gutters are 24–32rpx,
section gaps 24rpx, card padding 28–32rpx, and dense control gaps 12–16rpx.
Use current HIG-aligned type tokens; reserve 60rpx for the page title, 38–44rpx
for section/card titles, 30–32rpx for body, and 24–28rpx for metadata.

Card radii are 24–32rpx. Pills and chips use full radius. Borders are one visual
pixel and never brighter than content. Shadows are subtle blue-black ambient
separation, not floating white glows. Gradients are limited to the primary
Generate/Search action and selected high-value controls.

## Component recipes

### Trip Context chips

Wrap on multiple rows, use filled navy controls, and keep each label concise.
Removal has a 44px-equivalent target and an accessible text label. `编辑` opens
the detailed context editor; it is not another chip.

### Conversation

User messages use a blue filled bubble aligned right. Planner messages use an
open rail: small FlightOR mark/avatar, dark surface, and readable 1.5 line
height. Artifact cards begin after the reply with independent spacing and do
not visually merge into the message bubble.

### Artifact cards

Every card exposes type, title, freshness/verification state when present,
compact summary, and one clear next action. Research uses cool periwinkle,
flight uses blue, and route draft uses teal. Warning states use amber text and
border accents without tinting the entire card.

### Generate Route

Full-width primary action after the current planning artifacts. Disabled or
unavailable states are explicit, use a quiet surface, and include the blocking
reason. It never appears enabled solely because local mock fields are complete.

### Flight Explorer

Use stacked control rails for exact dates, connection class, and sort. Matrix
cells are tabular and high contrast when supplied by an Artifact. Results
prioritize schedule and price; risk is a separate amber row. Map is a
collapsible support panel and never substitutes local coordinates.
No bottom tab bar is shown on this subpage.

## Responsive and accessibility constraints

- Primary target: 375–430 CSS px mobile and WeChat mini-program.
- H5 desktop centers a 430–520px workspace or expands artifact grids only when
  cards retain readable line length.
- Touch targets are at least 44 CSS px equivalent.
- Text and essential state meet WCAG AA contrast where the platform permits.
- Icons supplement labels; they never carry the only meaning.
- Loading skeletons preserve layout; reduced motion disables decorative motion.
- Map and matrix always have a textual equivalent.

## Fidelity ledger

| Concept element | Implementation status | Truth constraint |
| --- | --- | --- |
| Header, Trip title, chips | implemented | values only from current server Trip summary; removal is a new Agent edit, never a local mutation |
| Message/artifact separation | implemented | turn refs render after replies; manual/run refs render in a distinct workspace section |
| Research/flight/route cards | implemented | complete payload loaded through owner-scoped `GET /v1/artifacts/:id` |
| Generate Route CTA | implemented | only server-advertised capability; terminal result becomes a workspace Artifact ref |
| Four-tab navigation | implemented | Plan, Explore, Trips, Profile; Flight Explorer is a subpage |
| Explorer date/mode/sort rails | implemented | controls reflect query/artifact coverage |
| Flexible price matrix | withheld when unavailable | rendered only for explicit local Mock data; current production Artifact has sampled-date offers but no matrix cells |
| Flight results and risk | implemented | provider offers only; legal/visa conclusions remain absent unless supplied |
| Alternate airports | withheld when unavailable | the Phase 6 manual UI searches one canonical pair and removes unsupported candidate-airport controls instead of silently narrowing them |
| Map | partial, truth-first | explicitly unavailable without verified coordinates; no local/random coordinates |

Update this ledger during visual QA. A concept mismatch is acceptable only when
recorded here with a data, accessibility, platform, or contract reason.
