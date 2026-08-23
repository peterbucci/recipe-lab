# Account authentication and sessions

RCP-23 adds the account and session foundation for later private activity and
recipe publishing. It does not move the existing save, rating, view, fork, or
recommendation routes away from the shared Demo Cook; that principal cutover is
RCP-24. A signed-in account and the demo interaction profile are therefore
separate concepts in this release.

## Public contract

Anonymous visitors can continue to browse recipes, open details, and compare
versions. The account surface adds:

- `GET /api/auth/login?return_to=/relative-path` to begin sign-in;
- `GET /api/auth/callback?code=...&state=...` for the provider callback;
- `GET /api/auth/session` to read anonymous, onboarding-required, or
  authenticated state;
- `PATCH /api/auth/session/profile` to finish onboarding or update the account
  handle and display name; and
- `POST /api/auth/logout` to revoke the current application session.

The browser calls these endpoints through the same-origin Next.js `/api`
proxy. Browser session responses contain only the local user ID, handle, and
display name. They never contain the private email, OIDC issuer or subject,
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
session token. Only its SHA-256 digest is stored. The token cookie is
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

## Configuration

Copy `.env.example` and set the hosted provider values:

```dotenv
APP_ENVIRONMENT=local
AUTH_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
OIDC_ISSUER=https://provider.example.com
OIDC_CLIENT_ID=recipe-lab-local
OIDC_CLIENT_SECRET=replace-if-the-provider-requires-one
OIDC_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

The redirect URI must be registered exactly with the provider. Production must
use HTTPS and `APP_ENVIRONMENT=production`; that environment enables secure
cookies. Keep client secrets outside version control and inject them through
the deployment secret store. When issuer or client ID is absent, the product
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

RCP-23 intentionally does not add password storage, social-account linking,
custom MFA, recipe publishing, public cook profiles, or account-scoped recipe
activity. Those capabilities build on this boundary in later stories.

## Verification

Backend tests cover migration round trips, exact issuer/subject reuse, session
digest storage, callback validation failures, return-path safety, cookie
attributes, Origin/CSRF enforcement, revocation, expiry, and account status.
Frontend tests cover the same-origin proxy, sign-in, onboarding, account menu,
session expiry, sign-out, keyboard operation, mobile layout, and accessibility.
Provider behavior is tested with a local fake; CI does not require a real OIDC
tenant or secrets.
