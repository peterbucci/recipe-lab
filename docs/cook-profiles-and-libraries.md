# Cook profiles and recipe libraries

RCP-29 makes persisted recipe authorship visible without turning Recipe Lab
accounts into a general social graph. Public recipe cards and details identify
the author of the exact immutable version being shown. A direct fork also names
its exact parent version and that parent's author when the parent remains
publicly readable. This describes provenance only; it does not imply
endorsement, collaboration, or ownership of another cook's descendants.

## Public identity boundary

Every public cook reference is an explicit three-field value:

```json
{
  "id": "<stable Recipe Lab user UUID>",
  "handle": "cook_handle",
  "display_name": "Cook Name"
}
```

The stable ID is the durable identity, the normalized unique handle is the
route key, and the display name is presentation text. Public adapters never
serialize email, OIDC issuer or subject, session data, authentication tokens,
account lifecycle state, private activity, saves, ratings, or draft data.
Account withdrawal, deleted-cook presentation, and moderation belong to later
stories and are not inferred here.

The deterministic seed catalog uses the reserved
`recipe-lab-catalog` handle. Its public versions therefore carry honest catalog
provenance instead of looking anonymous or being attributed to a real member.
The non-login Demo Cook remains only a compatibility identity for historical
private activity and receives no public profile handle from RCP-29.

## Public recipe attribution

Public browse, detail, recommendation, profile, saved-library, and
authored-library recipe summaries use the same bounded card contract. Diff and
lineage references use the same exact-version author projection. It includes:

- `author`, the public reference for that exact version's creator;
- `parent_version_id`, the immutable direct-parent identity when the version is
  a fork; and
- `parent`, a bounded reference containing the direct parent's ID, version
  number, title, and author only when that parent is also publicly readable.

It is valid for `parent_version_id` to be present while `parent` is `null`. That
shape preserves topology without leaking the title or author of a parent that
is not public. No adapter performs per-card author or parent requests; the API
loads the bounded context in fixed batched queries.

## Public profiles

`GET /api/cooks/{handle}` is anonymous and paginated. Handle lookup is
case-insensitive after the same trim-and-lower normalization used at account
creation. A known cook with no public recipes returns a valid empty page; an
unknown handle returns `404 cook_not_found`. Profile items contain only
explicitly published versions authored by that cook. Private drafts, saves,
ratings, events, authentication data, and recipes authored by someone else do
not enter the response.

The web route `/cooks/{handle}` presents that same public-only list with normal
loading, not-found, empty, error, pagination, keyboard, and responsive states.

## Private member libraries

The two private endpoints accept no user identifier. They derive the member
solely from the active Recipe Lab session, return `Cache-Control: private,
no-store`, and vary on the session cookie:

- `GET /api/my/recipes` database-pages one recent activity stream containing
  the current member's active private drafts and explicitly published versions.
  Discriminated entries keep draft data separate from public recipe summaries.
  The UI labels each item as an original or fork and labels drafts as private.
- `GET /api/my/saved-recipes` database-pages only public versions currently
  saved by the current member, ordered by the server-recorded save time.

The matching web routes are `/account/recipes` and
`/account/saved-recipes`. Signed-out visitors use the existing account gate.
One member cannot select another member's drafts, authored-library entries, or
saves by changing a query parameter or URL because no such selector exists.

RCP-29 does not add follows, comments, feeds, messages, notifications, public
email, analytics, profile images, withdrawal, deletion, or moderation.

## Verification contract

Backend coverage uses multiple members and a three-version cross-user chain to
prove exact-version author and direct-parent attribution. It also covers an
unpublished-parent/public-child edge, empty and unknown profiles, pagination,
private-library isolation, cache headers, recursive private-field exclusion,
and fixed query-count bounds as page size grows. Frontend unit and browser
coverage exercises public profile and private library loading, empty, error,
not-found, pagination, account gating, authorship labels, fork provenance,
keyboard access, responsive layouts, and the absence of per-card API fan-out.
