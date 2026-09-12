# ADR 0014 — Preserve provider connecting fares as complete offers

Status: accepted and implemented, 2026-09-08.

## Problem

The shared SerpApi fare adapter already retains connecting itineraries, but the
live route adapter accepts only direct flights. Connecting offers therefore
disappear when generating and comparing complete routes. The frontend also
reduces connections to one hub, and normalization assumes baggage need not be
rechecked without provider evidence.

## Decision

- Retain every valid provider itinerary as one offer with its complete segment
  list, connecting airports, reported layover durations and total quoted price.
  Reject an incomplete itinerary as a whole; never drop a bad segment and keep
  the original price attached to a shortened journey.
- A connecting fare becomes one route edge containing all its segments and a
  single total fare. Preserve immutable fare Artifact and offer references for
  confirmation. Do not invent individual segment prices.
- `airline` describes a provider-returned connecting itinerary. It does not
  establish protected ticketing, baggage transfer or entry permission. Explicit
  `self` results remain subject to self-transfer consent. Keep unavailable
  protection and baggage facts unknown.
- Route validation counts internal transfers and examines internal airports,
  time order, airport changes and connection constraints as well as transfers
  between route edges. A provider quote alone is not a feasibility certificate.
- Fare confirmation compares the complete itinerary, preserving route identity.
- Search cards, comparison and detail views retain all segments and show each
  connection separately. Unknown layover or baggage facts stay unknown.
- Total duration is optional when the provider has not returned it and some
  flight or layover durations are missing. Unknown waiting time is not zero;
  route constraints and output use the same elapsed-time calculation.
- Keep historical SerpApi baggage defaults in immutable payloads for audit,
  but mark unsupported values through the common Artifact presentation sidecar.
  Both client rendering and Agent artifact reads treat these fields as unknown.

## Acceptance

Regression coverage includes direct plus connecting results, multiple transfers,
missing/malformed segments, complete-offer pricing, unknown baggage/protection,
internal route constraints, fare confirmation and artifact-to-UI restoration.
Live evidence must distinguish provider-search success, stored snapshots and
route generation; build checks do not imply WeChat device acceptance.
