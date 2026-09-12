# ADR 0013: Explicit local test authentication

Status: Accepted, 2026-09-08

## Context

The local miniapp reaches the API, but WeChat login returns `503 WECHAT_NOT_CONFIGURED` because `WX_SECRET` is absent. The user chose a local test login connected to the real backend to unblock development.

## Decision

Add an explicit `/v1/auth/local` endpoint and a separately labelled miniapp action. It creates/reuses one `local_test` identity per local database and uses the existing JWT, rotating refresh token, user Memory and owner-scoped Trip repositories. The request cannot select a business user ID. The existing non-null `users.wechat_openid` column holds a reserved local compatibility anchor; `user_identities.provider=local_test` records the actual identity type.

The endpoint defaults to disabled. Enabling it requires a non-production environment, a loopback `HOST`, and a random key of at least 32 characters. Each request checks the actual socket address and key; forwarded IP headers are not an authorization source. The key is redacted from request logs. Production startup rejects the enabled flag.

Local access tokens carry a signed test-identity marker. Refresh uses the persisted `local_test` provider to retain that marker. Both access and refresh reject test credentials when local login is disabled or the environment is production, even if the signing secret is reused.

Only the explicit local build injects the test key and shows the action; its API URL must be loopback. Normal builds default to no test key. Third-party credentials and the JWT signing secret remain on the backend. WeChat failures remain visible and never automatically switch to a test identity.

## Consequences and verification

Local developer-tools testing can exercise real persistence and configured providers without WeChat code exchange. This local account is distinct from real WeChat accounts and is not accessible from phones over a LAN. Disable `LOCAL_LOGIN_ENABLED` and use the ordinary build to return to the normal login configuration.

Configuration, transport and identity tests pass, as do client session/cancellation/error tests. Live HTTP verification confirms local identity persistence, token rotation, re-login and Trip/workspace restoration. WeChat code exchange and device UI acceptance remain unverified. Commands and evidence are in [local-test-login.md](../local-test-login.md).
