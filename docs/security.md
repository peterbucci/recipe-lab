# Security and privacy

Recipe Lab treats the backend and PostgreSQL state as the authority for
authentication, authorization, lifecycle, visibility, idempotency, moderation,
and audit decisions. Frontend affordances improve the experience but never
grant authority.

This document is the maintained security and account-data contract. Product
topology is described in [Recipe model](recipe-model.md), runtime controls in
[Operations](operations.md), and restore handling in
[Recovery](reference/recovery.md).

## Access paths and authority

The frontend has two intentionally different API paths:

- Server-rendered public reads may use the server-only transport to the backend.
  That transport rejects browser cookies and CSRF headers and cannot act as a
  member.
- Browser and authenticated requests use the same-origin frontend `/api` proxy.
  Cookies stay same-origin, member mutations attach the session-bound CSRF
  token, and retry-safe operations carry a validated idempotency key.

Do not collapse these paths or forward a browser credential through the public
server transport. The proxy is a transport boundary, not an authorization
authority. Every protected backend operation re-resolves the live session,
account status, ownership, role grant, source visibility, and operation policy.

Session capability flags such as catalog review and recipe moderation are
derived from current database grants and help render navigation. They do not
replace backend authorization, cannot manage roles, and may be stale by the
time a user acts. Revocation and suspension take effect when the backend checks
the request.

Repositories own database access and locking but never commit. Domain services
own policy and multi-row transitions. A route or named workflow owns the final
transaction boundary. Keeping that ownership explicit is security-critical:
publication, visibility, moderation, account deletion, and audit records must
not become partially committed states.

## Provider authentication

Outside the demo sandbox, Recipe Lab delegates sign-in to a configured OpenID
Connect provider using Authorization Code flow with PKCE S256, one-time state,
and nonce. The backend performs discovery and code exchange and validates the
configured issuer, audience, signing algorithm, signature, expiry, nonce, and
verified-email claim.

A callback succeeds only when:

- state matches both the initiating browser's short-lived HttpOnly cookie and
  an unconsumed database transaction;
- the configured redirect URI is used exactly;
- discovery returns the configured issuer and secure provider endpoints;
- token issuer, audience, signature, algorithm, time, nonce, and email
  verification checks pass; and
- `return_to` is a local absolute path, never a scheme, network-path reference,
  or backslash redirect.

Provider identities are keyed by exact `(issuer, subject)`. Private email is
not an account-merge key and is never exposed by public profile or recipe
responses. Provider access, refresh, and ID tokens are request-local; they are
not browser session cookies and are not stored in browser storage.

Catalog Author and the seeded Demo Cook are non-login application identities.
They cannot acquire provider identities. Legacy activity is never reassigned to
a newly signed-in member.

## Application sessions and CSRF

After a valid callback, the backend issues a high-entropy opaque application
session token and stores only its SHA-256 digest. The cookie is `HttpOnly`,
`SameSite=Lax`, scoped to the application, and `Secure` outside explicit local
development. A separate high-entropy CSRF token is stored by digest while a
readable same-site cookie allows the frontend to send `X-CSRF-Token`.

Member mutations require all of:

- a live session for an active account;
- an exact trusted `Origin`; and
- a constant-time CSRF match.

Logout revokes the server-side session before clearing cookies. Expired or
revoked sessions and sessions belonging to suspended or deleted accounts are
anonymous. Activity may update `last_seen_at` at the bounded touch interval but
never makes provider authentication newer.

Account deletion additionally requires recent provider authentication. If the
session's immutable provider `auth_time` is absent or older than
`AUTH_RECENT_TTL_SECONDS`, the member must use the dedicated reauthentication
flow. It requests `prompt=login` and `max_age=0`, binds the transaction to the
current local session, accepts only the existing issuer/subject, and rotates
the session after fresh proof. Callback time is never substituted for missing
provider evidence.

Configuration lives in `.env.example`. Production uses HTTPS,
`APP_ENVIRONMENT=production`, an exact registered callback, and secret-store
injection. When issuer or client ID is absent, public browsing remains
available and sign-in fails safely.

## Demo accounts

The portfolio sandbox is the only non-provider account entry. It extends the
same authentication service, repository, workflow transaction, opaque session
cookie, CSRF protection, and backend member authorization. It does not invoke a
test session provisioner or log visitors into the seeded Demo Cook.

Each visitor receives an ordinary active member with no staff grants and no
provider authentication assurance. Demo entry is protected by exact Origin
checking, a random in-memory retry key, a generation-wide cap, and durable
network limits. Sign-out ends access to that account. A new visitor cannot
recover another visitor's drafts, and an active session is never silently
replaced with a different identity.

Provider reauthentication and account deletion are unavailable in this
profile. Expiry or operator replacement removes the entire isolated generation;
it is not ordinary account deletion and does not create a mutation path around
immutable published recipes. Passive views and research recommendations are
disabled. The full isolation and cleanup contract is in
[Operations](operations.md#portfolio-sandbox).

## Abuse and request controls

Sensitive route families are declared once in
`backend/app/policies/abuse.py`. The registry maps accepted methods and
operations to account/network limits; the enforcement service remains separate
from endpoint policy.

Every protected request increments a canonical network bucket. Authenticated
requests also increment an account bucket, and verified OIDC callbacks use a
separate issuer/subject bucket before first-account creation. Subjects are
HMAC-SHA-256 digests made with `ABUSE_RATE_LIMIT_SECRET`; raw IP addresses,
provider subjects, and user IDs are not stored in bucket keys. IPv4 networks
are grouped at `/24` and IPv6 at `/56` before hashing.

The public frontend deletes caller-supplied forwarding and internal-signal
headers, derives the network from its accepted socket, and signs a short-lived
method/path-bound signal. The same-origin proxy and backend validate that
signal. Invalid or expired signals fall back to the backend socket network.
`INTERNAL_NETWORK_SIGNAL_SECRET` is shared only between frontend and backend
and must be distinct from the abuse-limit secret.

Abuse counters intentionally commit in their own transaction before endpoint
work. Validation failures, authorization failures, conflicts, and later domain
rollbacks therefore cannot erase rate-limit evidence. An exceeded limit returns
HTTP 429 with `rate_limit_exceeded` and `Retry-After`; a counter persistence
failure makes protected writes fail closed with HTTP 503 and
`abuse_protection_unavailable`.

`MAX_REQUEST_BODY_BYTES` applies before routing or validation and checks both
declared and streamed bytes. Oversized requests return HTTP 413 with
`request_body_too_large`. Bodies are never included in rate-limit, size-limit,
or application logs.

Production must inject separate random secrets of at least 32 characters. The
documented local placeholders are rejected by production startup.

## Publication, visibility, and moderation

Public recipe versions are immutable snapshots. Publication requires an active,
onboarded member plus affirmative community-rules and publishing-rights
confirmations. The publication transaction records the versioned rules receipt,
rights timestamp, exact draft/source, stable-recipe edition topology,
idempotency evidence, and current pointer atomically.

Public reads share the backend visibility predicate. Browse, detail, profiles,
recommendations, libraries, diffs, source checks, and duplicate candidates must
not reimplement or post-filter that policy. Exact versions use neutral
unavailability for unknown, author-withdrawn, and moderation-hidden content.
Stable-current reads never fall back to an older edition when the current one is
hidden.

Author withdrawal and moderator visibility are independent axes. A moderator
restore cannot override an author's withdrawal, and an author cannot restore a
moderation-hidden version. Adaptation and revision publication recheck source
visibility while holding the publication/topology locks. Failure leaves the
private draft intact and writes no partial public state.

An active member may report a public exact version using one fixed reason,
optional bounded private details, and a UUID idempotency key. Reports do not
automatically hide recipes and are not recommendation signals. Public responses
never expose reporter identity or details.

`community_moderators` and `catalog_curators` are separate least-privilege
database roles. Moderator actions are `hide`, `restore`, or `resolve`; each
creates server-timestamped audit evidence with a private bounded note. Ordinary
writes cannot change that evidence. During account deletion, a narrow scrub
exception removes the deleting moderator's private note and request fingerprint
while retaining the action, target topology, before/after state, and timestamp.
Role administration has no public HTTP endpoint. Operators use the bounded
backend CLIs from an authorized database environment:

```powershell
cd backend
python -m app.moderators eligible --query <UUID_OR_HANDLE> --limit 25
python -m app.moderators list --limit 100
python -m app.moderators grant --user-id <USER_UUID> --granted-by-user-id <OPERATOR_USER_UUID>
python -m app.moderators revoke --user-id <USER_UUID>
```

CLI access is authorized by deployment/database operations, not by the optional
audit actor argument.

## Account-data governance

`backend/app/privacy/account_data_manifest.py` is the field-level authority for
every table reachable from `users.id`. Each field or relationship is classified
as delete, anonymize, retain with a reason, or prohibit. The independent
`backend/tests/test_account_data_manifest.py` walks SQLAlchemy metadata and
fails when a new account-linked path lacks an explicit decision. The manifest
is a review gate, not generated deletion code.

Ordinary deletion is one locked backend transaction. It removes provider
identity, private email, handle/profile text, sessions, held roles, saves,
ratings, preference events, active private drafts and children, unresolved
private catalog workflow data, and unbound similarity evidence. Reviewed
catalog evidence and public-bound audit records retain only their justified,
anonymized shapes.

Published versions, stable recipe identity, append-only editions, adaptation
lineage, visibility history, publication-bound duplicate evidence, and the
minimum moderation topology remain. Stable recipes lose active
`owner_user_id`; attribution resolves only to a constrained `Deleted cook`
tombstone. Published-draft receipt shells retain replay topology but no authored
content. A later provider sign-up creates a new account and cannot recover the
deleted account's authority or activity.

Backups may retain pre-deletion bytes for at most the configured 30-day maximum,
but they cannot be exposed directly. Any older restore stays isolated, receives
current migrations and externally retained deletion-ledger replay, passes the
account-data and community verifiers, and only then becomes eligible for
traffic. Missing or stale deletion evidence fails closed; see
[Recovery](reference/recovery.md#restore-order).

The public sandbox prohibits backups, replicas, observed-member exports, and
durable content caches instead of using the persistent profile's retention
window.

### Exceptional erasure

Exceptional privacy/security erasure of published content is not implemented.
Ordinary account deletion, visibility, moderation, current-pointer changes, and
database administration must not impersonate it. Do not disable immutability
triggers or directly update/delete snapshots.

Such a capability requires a legal/privacy-approved field and retention policy,
a separate strongly authenticated authority, an audited idempotent fail-closed
operation, downstream propagation through replicas/backups/caches/exports, and
rehearsed topology/recovery consequences. Until then, isolate the affected
systems, preserve restricted evidence, and escalate rather than improvising a
product mutation.

## Logs, scans, and test evidence

Production backend HTTP access logs are disabled. Proxies, CDNs, load balancers,
APM, and analytics must preserve that no-request-target rule. Callback URLs,
paths, queries, bodies, headers, cookies, IPs, emails, handles, account-derived
IDs, provider data, report text, moderator notes, stack traces, and exception
messages are forbidden from operational sinks.

The backend structured-event allowlist is:

- `authentication_failure`
- `publication_failure`
- `database_failure`
- `application_failure`

Each event contains only its fixed name and an application-issued random UUIDv4
correlation ID. The frontend proxy may emit only
`recipe_lab.frontend.authentication_failed` and
`recipe_lab.frontend.recipe_api_unavailable`, adding only numeric status code.
Request events expire within 7 days. De-identified low-cardinality aggregate
metrics expire within 30 days. Adding an event, field, label, storage sink,
cache, export, or derived artifact is a governance change and must update the
manifest and tests.

Security CI scans locked runtime dependencies and reviewed committed source for
HIGH/CRITICAL vulnerabilities and secrets. Raw findings, scanner JSON,
requirements exports, source archives, dumps, ledgers, browser output, and logs
remain in restricted temporary storage and are cleaned even after failure.
Secret matches are never printed or uploaded. A passing scan cannot prove a
credential was never exposed in history; rotate any possibly exposed value
through its private provider workflow.

Authenticated browser traces, screenshots, videos, manifests, logs, and dumps
are prohibited for real accounts. Synthetic release evidence is reduced to
bounded identifier-free summaries. Source archives and production images must
contain no account data or secrets.

## Security review checklist

For a new mutation or account-linked store, verify all of the following:

1. The backend re-resolves authentication, account state, ownership, role, and
   policy; the UI is not the authority.
2. Origin, CSRF, request size, abuse class, and idempotency behavior are
   explicit.
3. Repository, service, locks, transaction owner, and rollback behavior are
   clear; no repository commits.
4. Public errors remain neutral and do not reveal private or unavailable data.
5. The account-data manifest states delete/anonymize/retain/prohibit behavior,
   including backup and restore propagation.
6. Logs, metrics, tests, exports, and caches cannot become a second account
   history.
7. Focused authorization, isolation, retry, concurrency, privacy, and recovery
   tests protect the invariant.
