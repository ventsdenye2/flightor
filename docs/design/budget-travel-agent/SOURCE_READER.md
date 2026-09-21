# Public research source reader

Status: implemented in `backend/src/research-agent/source-reader.ts`; unit-tested with an injected resolver and transport. This component is a bounded source fetch primitive integrated into the Cloud Planner SerpApi synthesis path. It is not itself evidence that a source claim is current or applicable.

The reader accepts HTTPS URLs on port 443 without credentials, resolves public IPv4 records before connecting (AAAA records are outside this deliberately smaller boundary), rejects any non-public answer, pins the selected public IPv4 while preserving the original hostname for the HTTP Host header and TLS SNI, rejects redirects, cookies/authentication, compressed responses, non-HTML/plain content, and bodies over 256 KiB. It applies one eight-second deadline across DNS, connection, response, and body read; caller cancellation destroys the request through the shared abort signal. Extracted text is bounded to 12,000 characters and returned with retrieval time and a SHA-256 content hash.

The request is observed as `http/research-source-read`. Tests cover unsafe URLs, private or mixed DNS answers, redirects, encoding/content type, body limits, cancellation, timeout, and HTML entity/tag extraction. Real DNS/TLS/provider reachability and integration into native research synthesis remain unverified by these unit tests.

2026-09-21 integrated checks: 8 reader tests passed; full backend 99 files / 783 tests passed in 87.00 s. Real application reader: Meiji Jingu HTTPS body read succeeded in 1.748 s; Tokyo Metro returned HTTP 403 in 0.790 s. The latter remains an explicit failure, not a verified price. Native research was not changed.

Post-live review narrowed documentation-network rejection to the actual subnets instead of entire 203/8 and adjacent public ranges; 10 targeted reader tests passed in 0.653 s, including pinned transport arguments, pre-cancel and stalled-body deadline. This follow-up was not used to relabel the frozen live result.
