# Community rules, reporting, and moderation

Recipe Lab uses a small, reviewable safety boundary for public recipes. It is
not an automated content-ranking or machine-learning moderation system. Members
choose from a fixed report vocabulary, community moderators make explicit
decisions, and PostgreSQL retains the evidence needed to explain those
decisions.

## Publishing agreement

Every new publication requires two affirmative confirmations:

1. the member has read and accepts the current Recipe Lab community rules; and
2. the member created the recipe content or otherwise has the right to publish
   it.

The API accepts only literal `true` values for both confirmations. A successful
publication stores the versioned rules identifier and a server-generated rights
confirmation timestamp alongside the immutable publication receipt. Legacy
seeded publications remain readable without fabricating an agreement that their
authors never made.

The community rules prohibit harassment, spam, knowingly dangerous or
deceptive cooking guidance, and publication of content the member has no right
to share. They also ask members to describe recipes honestly and to respect the
curated ingredient, measurement, and action vocabularies. These rules govern
public content; they do not turn Recipe Lab into a medical or food-safety
authority.

## Member reports

An active, onboarded member can report a currently public immutable recipe
version with `POST /api/recipes/{recipe_version_id}/reports`. The request uses a
UUID `Idempotency-Key`, one fixed reason, and optional trimmed details of at most
1,000 characters. Supported reasons are:

- `spam`
- `harassment`
- `dangerous_content`
- `intellectual_property`
- `other`

One member can create only one report for a recipe version. An exact retry of
the same action key and payload reuses the receipt; changing the payload behind
that key or reporting the same version under another key is rejected. A report
does not automatically hide a recipe and is not a recommendation signal.

Reporter identity and report details are private. They are absent from recipe,
profile, library, diff, lineage, recommendation, and public visibility
responses. When a member deletes their account, their retained report evidence
is de-identified and its free-text details are erased.

## Moderator workflow

`community_moderators` is a narrow role separate from
`catalog_curators`. A curator is not automatically a moderator, and a moderator
is not automatically a curator. The authenticated session advertises the
`moderate_recipe_reports` capability only while the active, onboarded member has
a current database grant.

The moderator-only API provides:

- `GET /api/moderation/recipe-reports` for a bounded aggregate queue;
- `GET /api/moderation/recipe-reports/{recipe_version_id}` for reason counts,
  bounded de-identified reports, and bounded audit history; and
- `POST /api/moderation/recipe-reports/{recipe_version_id}/actions` for
  `hide`, `restore`, or `resolve` decisions with an optional private note.

The queue exposes a reporter count, never reporter identities. Hide and restore
change only the moderator-controlled visibility axis. An author's withdrawal is
independent, so restoring a moderation-hidden recipe cannot override an earlier
author withdrawal. Resolve closes the review case without silently changing
visibility. A later independent member report reopens a resolved case.

Every moderator action uses a UUID idempotency key and creates an append-only,
server-timestamped audit event containing the actor, action, resulting case
status, resulting visibility state, and optional bounded private note. The
moderation page and API are unavailable immediately after the grant is revoked
or the member is suspended.

## Operator role management

Role administration is deliberately outside the public HTTP API. An operator
with database access can use the bounded command-line interface:

```powershell
cd backend
python -m app.moderators eligible --query <UUID_OR_HANDLE> --limit 25
python -m app.moderators list --limit 100
python -m app.moderators grant --user-id <USER_UUID> --granted-by-user-id <OPERATOR_USER_UUID>
python -m app.moderators revoke --user-id <USER_UUID>
```

`eligible` and `list` expose only stable user IDs, handles, display names, role
flags, eligibility, and grant audit metadata. They never expose email, OIDC,
session, or token data. `--granted-by-user-id` is optional audit attribution;
it does not authorize the command. Authorization to run the command belongs to
deployment and database operations. There is no member-facing self-promotion or
grant endpoint.

## Abuse controls and request boundaries

Mutating account-authentication, draft, publication, fork, reporting, and
interaction seams use durable fixed-window limits. Authenticated activity is
bounded by both a pseudonymous account subject and a canonicalized network;
first sign-in/account creation adds a pseudonymous OIDC issuer/subject limit.
Counters are atomically persisted before endpoint work begins, so a later
validation failure or transaction rollback cannot erase the attempt.

Network and identity subjects are stored only as keyed HMAC-SHA-256 digests.
IPv4 addresses are grouped to `/24` and IPv6 addresses to `/56` before hashing.
The application does not persist raw network addresses in rate-limit rows.
Expired buckets can be removed without changing moderation or publication
evidence.

Exceeded limits return the standard error envelope with HTTP 429,
`rate_limit_exceeded`, and a `Retry-After` header. If durable abuse protection
cannot be recorded, protected writes fail closed with HTTP 503. Request bodies
larger than the configured application-wide byte limit are rejected with HTTP
413 before routing, whether the excess is declared by `Content-Length` or
arrives in streamed chunks.

Production must provide separate private `ABUSE_RATE_LIMIT_SECRET` and
`INTERNAL_NETWORK_SIGNAL_SECRET` values. The body limit, fixed-window duration,
and per-operation account/network limits are configurable through the documented
environment variables in `.env.example`. Application
logs must not include request bodies, report details, private moderation notes,
email addresses, OIDC subjects, session tokens, CSRF tokens, or the HMAC secret.

## Account status and non-goals

Suspended or deleted members cannot publish, fork, save, rate, report, or enter
the moderator workspace because every seam revalidates the live account state.
Public content lifecycle, account deletion, and `Deleted cook` attribution are
documented separately in
[recipe visibility and account lifecycle](recipe-visibility-and-account-lifecycle.md).

This MVP intentionally excludes automated moderation, toxicity models,
appeals, comments, follows, notifications, and a browser-based role-management
console. Those would require separate product, privacy, and governance stories.
