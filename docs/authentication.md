# Account authentication and sessions

RCP-23 adds the account and session foundation. RCP-24 uses that foundation for
private member activity: save, rating, recorded-view, fork, and personalized
recommendation history now derive their principal exclusively from the active
application session. Anonymous visitors retain public recipe browsing, details,
comparisons, and deterministic global recommendations.

## Public contract

Anonymous visitors can continue to browse recipes, open details, and compare
versions. The account surface adds:

- `GET /api/auth/login?return_to=/relative-path` to begin sign-in;
- `GET /api/auth/callback?code=...&state=...` for the provider callback;
- `GET /api/auth/session` to read anonymous, onboarding-required, or
  authenticated state;
- `PATCH /api/auth/session/profile` to finish onboarding or update the account
  handle and display name; and
- `POST /api/auth/logout` to revoke the current application session;
- `GET /api/auth/reauthenticate?return_to=/relative-path` to require a fresh,
  session-bound provider authentication before a sensitive action; and
- `DELETE /api/auth/account` to irreversibly remove the current member's
  private account data while preserving anonymous public recipe topology.

The browser calls these endpoints through the same-origin Next.js `/api`
proxy. Browser session responses contain only the local user ID, handle, and
display name plus narrow boolean catalog-review and recipe-moderation
capabilities. Those capability flags are derived from live, separate database
grants and confer no role-management authority. Session responses never contain the private email, OIDC issuer or subject,
provider tokens, application session token, or token digests.

## OIDC flow

Recipe Lab delegates authentication to a configurable hosted OpenID Connect
provider. It uses Authorization Code flow with PKCE (`S256`), a one-time state
value, and a nonce. The backend discovers the provider, exchanges the code
server-side, and validates the ID token signature, configured algorithm,
issuer, audience, expiry, nonce, and verified-email claim.

The callback is accepted only when all of these are true:

- the state matches both the initiating browser's short-lived HttpOnly cookie
  and an unconsumed database transaction;
- the configured redirect URI is used exactly;
- discovery returns the configured issuer and secure provider endpoints;
- the ID token satisfies the configured issuer, client, signing, time, nonce,
  and email-verification requirements; and
- the return path is a local absolute path, not a scheme, network-path
  reference, or backslash redirect.

An identity is keyed by the provider's exact `(issuer, subject)` pair. Email is
private contact data and is never used to merge identities. Repeated callbacks
for the same pair reuse one member. Catalog Author and Demo Cook are non-login
system/demo identities and cannot acquire OIDC identities.

## Application sessions and CSRF

After a valid callback, the backend creates a high-entropy opaque application
session token. Only its SHA-256 digest is stored. Each session also records an
immutable `authenticated_at` assurance timestamp; ordinary activity may update
`last_seen_at` but never makes authentication newer. The token cookie is
`HttpOnly`, `SameSite=Lax`, restricted to the application path, and `Secure`
outside explicit local development.

Each session also has an independent high-entropy CSRF token. Its digest is
stored with the session, while the readable same-site CSRF cookie lets the
frontend send the value in `X-CSRF-Token`. Account mutations require both an
exact trusted `Origin` and a constant-time CSRF match. Logout revokes the
server-side row before clearing both cookies.

Expired or revoked sessions and sessions for suspended or deleted members are
anonymous. Provider access, refresh, and ID tokens are never used as Recipe Lab
session cookies or stored in browser storage.

Account deletion requires provider-supplied `authenticated_at` evidence to fall
within `AUTH_RECENT_TTL_SECONDS`, which defaults to ten minutes. A session with
missing evidence is treated as stale; ordinary callback time is never invented
as authentication time. Provider timestamps beyond the configured clock skew
are rejected. A stale or unknown session must start the dedicated
reauthentication flow. That flow binds its one-time OIDC
transaction to the current local session, requests `prompt=login` and
`max_age=0`, and accepts only the exact existing issuer/subject with a fresh
provider `auth_time`. Success rotates the bound session. Failure uses one
generic message and changes no account data.

## Configuration

Copy `.env.example` and set the hosted provider values:

```dotenv
APP_ENVIRONMENT=local
AUTH_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
OIDC_ISSUER=https://provider.example.com
OIDC_CLIENT_ID=recipe-lab-local
OIDC_CLIENT_SECRET=replace-if-the-provider-requires-one
OIDC_REDIRECT_URI=http://localhost:3000/api/auth/callback
AUTH_RECENT_TTL_SECONDS=600
ABUSE_RATE_LIMIT_SECRET=replace-with-a-long-random-deployment-secret
```

The redirect URI must be registered exactly with the provider. Production must
use HTTPS and `APP_ENVIRONMENT=production`; that environment enables secure
cookies. Keep client secrets outside version control and inject them through
the deployment secret store. The production-only abuse-control HMAC secret
belongs in that same store and must not reuse an OIDC, database, or cookie
secret. When issuer or client ID is absent, the product
remains browsable but the sign-in start endpoint reports that authentication is
unavailable.

See `.env.example` for session lifetime, scopes, signing algorithms, login
lifetime, network timeout, and clock-skew settings. Cookie names are a fixed
cross-layer contract so runtime configuration cannot silently break CSRF.

## Privacy and lifecycle boundary

The database stores member email only for the verified provider identity and
the private user record. Public recipe or account responses do not expose it.
Login transactions expire quickly and are one-time use. Consumed rows are
deleted immediately, and later login starts prune expired abandoned rows;
sessions can be revoked independently. Stable errors and logs must not echo
authorization codes, state, nonce, session/CSRF tokens, provider subjects,
private emails, or provider response bodies.

The application suppresses callback-query logging in both the FastAPI access
logger and the Next.js development request logger. Production CDNs, reverse
proxies, load balancers, and observability tools must likewise drop or redact
the query string for `/api/auth/callback`; it must never be sent to analytics.

Recipe Lab does not transfer or attribute legacy Demo Cook saves, ratings,
events, or forks to a member. Catalog Author and Demo Cook remain seeded,
non-login identities for catalog provenance and historical compatibility, but
public reads and anonymous recommendations do not require the Demo identity to
exist. The legacy `/api/me` demo route is removed; `/api/auth/session` is the
only browser identity/session contract.

Deleting an account atomically removes its OIDC mapping, private email and
handle, every application session, saves, ratings, preference events, private
draft content, and other unreferenced private workflow evidence. Published
snapshots and fork relationships are not hard-deleted. Their stable author UUID
resolves only to an irreversible `Deleted cook` tombstone with no profile link.
See [recipe visibility and account lifecycle](recipe-visibility-and-account-lifecycle.md)
for the complete retention and unavailable-content contract. Recipe Lab still
does not store passwords, add custom MFA, merge social accounts, or expose
provider identity data.

## Verification

Backend tests cover migration round trips, exact issuer/subject reuse, session
digest storage, callback validation failures, return-path safety, cookie
attributes, Origin/CSRF enforcement, revocation, expiry, account status,
provider-backed reauthentication, all-session account deletion, private-data
erasure, retained public topology, member-scoped idempotency, and two-member
activity/recommendation isolation.
Frontend tests cover the same-origin proxy, sign-in, onboarding, pre-onboarding
account deletion, account menu,
session expiry, signed-out action gates, member interactions, keyboard
operation, mobile layout, and accessibility. The guarded full-stack acceptance
run provisions digest-only Alice, Bob, catalog-curator, separately granted
community-moderator, and deletion-only sessions in an isolated database; OIDC
provider behavior remains covered by a local fake, so CI needs no real tenant
or secrets. Reporting, role boundaries, and durable abuse controls are detailed
in [community rules, reporting, and moderation](community-moderation.md).

RCP-32 adds a stricter deployment-gate path alongside that broad regression.
Its guarded loopback provider implements discovery, ephemeral RS256 signing,
Authorization Code with PKCE S256, exact redirect matching, and single-use
short-lived codes. Alice, Bob, the curator, and the moderator traverse the real
callback and onboarding flow; no session or role is inserted by the browser
harness. The provider refuses production or non-loopback configuration, keeps
all private identity material in memory, and disables access logs. See the
[community release gate](community-release-gate.md) for its threat boundary and
privacy-safe evidence rules.
