# Security and privacy

Recipe Lab treats the backend and PostgreSQL state as the authority for authentication, authorization, account state, recipe visibility, moderation, and data-retention decisions. Frontend controls improve the user experience, but they do not grant access or replace backend checks.

This document describes the application's security and privacy model. For the recipe lifecycle itself, see [Recipe model](recipe-model.md). Runtime procedures and monitoring belong in [Operations](operations.md), while restore and rollback procedures belong in [Recovery](reference/recovery.md).

## Trust boundaries

Recipe Lab has two intentionally different frontend-to-backend paths.

```text
Public server-rendered read
  -> server-only frontend transport
  -> FastAPI

Browser/member request
  -> same-origin /api
  -> frontend API proxy
  -> FastAPI
```

Public server-side requests are anonymous. The server transport does not forward browser session cookies or CSRF credentials.

Browser requests use the same-origin proxy so application cookies remain scoped to the Recipe Lab origin. The proxy validates backend paths, removes untrusted forwarding headers, handles backend cookies safely, and forwards only the network evidence expected by the backend.

The proxy is still only a transport boundary. Protected backend operations independently resolve the current session, account state, ownership, staff grant, recipe visibility, and operation-specific policy.

## Authentication

Outside the portfolio demo environment, Recipe Lab uses a configured OpenID Connect provider with the Authorization Code flow and PKCE.

A login attempt uses one-time state, nonce, and PKCE values. The backend performs provider discovery and authorization-code exchange, then validates the returned identity before creating a Recipe Lab session.

Validation includes the configured:

- issuer;
- audience/client ID;
- signing algorithm and signature;
- token lifetime;
- nonce;
- verified-email requirement; and
- exact callback configuration.

The login transaction must match both the initiating browser and an unconsumed server-side transaction. Return destinations are restricted to safe local application paths; external, scheme-relative, or backslash-based redirects are rejected.

Provider identities are keyed by the exact provider `(issuer, subject)` pair. Email is not used to merge accounts and is not exposed through public recipe or profile responses.

Provider tokens are used only during authentication. They are not used as Recipe Lab browser sessions and are not stored in browser storage.

## Application sessions

After authentication, Recipe Lab issues its own high-entropy opaque session token. The database stores only a digest of that token.

The session cookie is:

- `HttpOnly`;
- `SameSite=Lax`;
- scoped to the application; and
- `Secure` outside explicit local-development environments.

A session is valid only while the backing session and member account remain valid. Revoked or expired sessions, and sessions belonging to suspended or deleted accounts, no longer authorize member requests.

The frontend may temporarily preserve authenticated UI state while a session is being recovered so unsaved work is not destroyed. That continuity behavior does not make the old session valid. Recovery succeeds only when the backend confirms a new valid session for the same account.

## CSRF and origin checks

State-changing member requests require both a valid application session and CSRF protection.

Recipe Lab uses a separate high-entropy CSRF token. The browser receives a readable same-site cookie and sends the matching value in `X-CSRF-Token`; the backend stores and compares only the token digest.

Protected mutations require:

- a live session for an active member;
- an allowed `Origin`; and
- a valid CSRF token match.

The frontend also validates idempotency keys for operations that support retry-safe mutation, but the backend remains authoritative for replay and conflict handling.

## Reauthentication for sensitive operations

Some operations require stronger proof than an existing long-lived application session. Account deletion is the main example.

If the provider authentication represented by the current session is too old, Recipe Lab requires a dedicated reauthentication flow. That flow requests fresh provider authentication, binds the attempt to the current Recipe Lab session, and accepts only the same provider identity that already owns the account.

A successful reauthentication rotates the local application session. Callback time alone is not treated as proof that the provider actually reauthenticated the member.

## Authorization

Authorization is checked on the backend at the point where protected data or mutations are accessed.

Examples include:

- private drafts are queried by both draft ID and owning member;
- author-only recipe visibility actions re-check authorship;
- source recipes are re-checked for public availability before publication;
- curator and moderator operations check the current database grant;
- account lifecycle operations re-check the active account and session requirements.

A missing or unauthorized private resource should not reveal whether another member owns it. Owner-scoped private lookups therefore use neutral not-found behavior where appropriate.

Frontend route gates, hidden buttons, and session capability flags are presentation aids. They are never the security boundary.

## Staff roles

Catalog curation and community moderation are separate least-privilege roles.

- Catalog curators review ingredient-catalog requests.
- Community moderators review reports and recipe visibility cases.

The frontend may use session capability hints to decide which tools to show, but every privileged backend request checks the live database grant again. Removing a grant therefore takes effect at the next backend authorization check even if an older browser session still displays the tool.

Role administration is not exposed through the public application API. Operator procedures belong in [Operations](operations.md).

## Published recipe integrity and visibility

Published recipe versions are immutable application history. Editing happens in private drafts, and publishing creates a new public snapshot rather than overwriting an existing one. The detailed model is documented in [Recipe model](recipe-model.md).

Security-relevant rules include:

- publication is a backend-owned transaction;
- the source recipe is re-checked before a revision or adaptation is published;
- failed publication does not leave partially published state;
- public reads use the shared backend visibility policy rather than implementing their own filters;
- author withdrawal and moderation hiding are independent; and
- restoring one visibility axis must not bypass the other.

Reports are private moderation input. Public recipe responses do not expose reporter identity, report details, moderator notes, or other moderation-only data.

Moderation actions create audit evidence. Ordinary application writes cannot rewrite that evidence. Account deletion has a narrow privacy exception that removes private actor-specific moderation content while preserving the action and public/audit topology needed to explain what happened.

## Abuse and request controls

Sensitive route families are assigned abuse limits in the backend. Enforcement is separate from the endpoint's domain logic so a rejected or rolled-back request still counts as an attempt.

Protected requests can be limited using network and, for authenticated requests, account buckets. Authentication callbacks also use a provider-identity bucket before account creation.

Bucket identifiers are derived rather than stored as raw identifiers. Network data is normalized before hashing, and provider subjects or account identifiers are not stored directly in rate-limit keys.

The frontend proxy removes caller-supplied forwarding, proxy-proof, and internal-signal headers before Next.js or the backend can observe them. By default it derives the trusted network signal only from the direct socket peer. A deployment may opt into `X-Forwarded-For` only by configuring both narrow trusted-proxy ranges and a separate high-entropy proof that the reviewed proxy overwrites on every request. Both the direct peer and the proof must match; otherwise the frontend ignores the forwarded chain. If the resulting frontend signal cannot be validated, the backend falls back to the connection information it can trust itself.

In the ephemeral portfolio sandbox, `/readyz` also requires a fresh regular
heartbeat file mounted read-only from the host supervisor. The heartbeat check
runs before the shared, short-lived backend readiness probe and again before a
successful response. A missing or stale supervisor heartbeat therefore removes
the instance from proxy routing without amplifying concurrent external probes
into one database check per request.

Abuse-counter updates intentionally commit before the protected endpoint runs. A later validation error, authorization failure, conflict, or domain rollback must not erase the recorded attempt.

When a rate limit is exceeded, the API returns a bounded error and retry information. If abuse-protection persistence fails for a protected write, the operation fails closed rather than continuing without enforcement.

Request-body limits are applied before normal route processing. Oversized bodies are rejected without logging their contents.

## Account deletion and retained history

Account deletion is a privacy-sensitive backend workflow, not a frontend cleanup operation.

`backend/app/privacy/account_data_manifest.py` is the maintained inventory for data reachable from a user account. Account-linked fields and relationships are explicitly classified for deletion, anonymization, retention with justification, or prohibition. Tests verify that new account-linked storage receives an explicit decision.

Ordinary deletion removes private account data and authority, including information such as:

- provider identity and sessions;
- private email and profile data;
- staff grants;
- saves, ratings, and private preference history;
- active private drafts and their private content; and
- private workflow data that no longer has a justified retained purpose.

Published recipe history is different. Recipe Lab retains the minimum account tombstone needed to preserve public attribution and recipe-history integrity without retaining the deleted member's private identity. Public history resolves to a deleted-cook representation rather than transferring ownership to another account.

A later sign-up through the same provider does not recover the deleted account's drafts, authority, or activity.

Backup and restore behavior must preserve deletion guarantees. Restore procedures and deletion-ledger replay are documented in [Recovery](reference/recovery.md).

Recipe Lab does not currently provide a separate product operation for exceptional erasure of already-published immutable recipe content. Such an operation would require its own privacy/legal policy, authority model, audit behavior, and recovery consequences; it must not be improvised by disabling integrity protections or directly editing published snapshots.

## Logging and operational privacy

Operational telemetry is intentionally narrow.

Production backend HTTP access logs are disabled because ordinary request targets can contain sensitive identifiers or authentication callback data. Infrastructure around the application must preserve the same privacy expectation.

Operational sinks must not contain:

- request paths or query strings containing user data;
- request or response bodies;
- cookies or authorization credentials;
- raw IP addresses;
- emails or handles;
- account-derived identifiers;
- provider subjects or tokens;
- report text or moderator notes;
- stack traces or raw exception messages containing request data.

The backend's structured operational event allowlist is deliberately small:

- `authentication_failure`
- `publication_failure`
- `database_failure`
- `application_failure`

These events contain only the approved event name and an application-issued correlation identifier.

The frontend proxy has its own bounded event set for authentication failure and backend availability, with only the limited status information required for operations.

Adding a new event, field, metric label, cache, export, or data sink is a privacy decision, not just an observability change. The account-data/retention policy and tests must be updated when new account-linked information is retained.

Retention periods, alerts, and operator procedures are documented in [Operations](operations.md).

## Security testing and release evidence

Recipe Lab tests security at several layers rather than relying on one scanner or one test suite.

Examples include:

- authentication and session tests;
- CSRF and origin checks;
- draft privacy and account-isolation tests;
- staff-authorization tests;
- publication and visibility tests;
- moderation and audit tests;
- account-deletion and recovery tests;
- abuse-control tests;
- privacy-safe observability tests;
- dependency and secret scanning;
- production-image verification; and
- integrated release/recovery exercises.

Real authenticated-account traces, screenshots, dumps, browser recordings, or logs should not be retained as test artifacts. Release evidence uses synthetic or bounded data instead.

For the purpose of each test tier and the commands that run it, see [Testing](testing.md).

## Portfolio demo environment

The public portfolio demo uses the same application session, CSRF, backend authorization, and private-draft boundaries as the normal application, but it is intentionally limited.

Demo visitors receive isolated ordinary member accounts without staff grants or provider-authentication assurance. One visitor cannot recover another visitor's private drafts.

Provider reauthentication and normal account deletion are not available in this environment. The demo generation is temporary and can be replaced as a whole; operational isolation and cleanup are documented in [Operations](operations.md#portfolio-sandbox).

The demo environment must not be treated as a shortcut around the normal security model.

## Security review checklist

When adding a mutation or new account-linked storage, verify that:

1. The backend, not the UI, is the authority for authentication, ownership, staff roles, and policy.
2. Origin, CSRF, request-size, abuse-limit, and idempotency behavior are explicit where applicable.
3. Transaction ownership and rollback behavior are clear; repositories do not create hidden commits.
4. Private or unavailable resources are not exposed through overly specific errors.
5. Account deletion and retention behavior is recorded in the account-data manifest.
6. Logs, metrics, caches, exports, and tests cannot become an unintended second copy of private account history.
7. Authorization, isolation, retry, concurrency, privacy, and recovery behavior have focused tests at the appropriate layer.
