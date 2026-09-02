# Cook profiles and recipe libraries

RCP-29 makes persisted recipe authorship visible. Public recipe cards and
details identify the author of the exact immutable version being shown. A
direct fork also names its exact parent version and that parent's author when
the parent remains publicly readable. This describes provenance only; it does
not imply endorsement, collaboration, or ownership of another cook's
descendants.

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
route key for an active cook, and the display name is presentation text. A
deleted account's retained topology reference has `handle: null` and fixed
display name `Deleted cook`. The fixed, non-login Demo Cook identity is the
only compatibility exception for legacy public recipes and likewise has no
handle. Both render as plain text without a profile link; arbitrary active
handle-less identities are rejected. Public adapters never serialize email,
OIDC issuer or subject, session data, authentication tokens, private activity,
saves, ratings, or draft data. The erasure and retention policy is documented in
[recipe visibility and account lifecycle](recipe-visibility-and-account-lifecycle.md).

The deterministic seed catalog uses the reserved
`recipe-lab-catalog` handle. Its public versions therefore carry honest catalog
provenance instead of looking anonymous or being attributed to a real member.
The non-login Demo Cook remains a compatibility identity for historical
activity and receives no public profile handle from RCP-29.

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
currently public versions authored by that cook. A deleted cook has no handle,
so the former profile route becomes the same opaque not-found response as an
unknown handle. Private drafts, saves, ratings, events, authentication data,
and recipes authored by someone else do not enter the response.

The profile response also carries one optional, plain-text `description` at
the profile level. It is bounded to 500 characters, is never copied into the
three-field author reference, and is cleared when the member deletes their
account. The web header presents the handle, live follower total, and public
recipe total in one metadata row, followed by the optional description and the
follow action.

The web route `/cooks/{handle}` presents that same public-only list with normal
loading, not-found, empty, error, pagination, keyboard, and responsive states.

## Member following

A signed-in member can follow or unfollow another active cook from that cook's
public profile. Follow relationships are deliberately small in scope: they do
not grant access to drafts, private activity, email, sessions, or any other
account data. A member cannot follow their own account, repeated follow and
unfollow requests are safe, and deleting either account removes the
relationship.

The public profile includes only the cook's follower total. Private follow
state is read from `GET /api/cooks/{handle}/follow`, changed with `PUT` or
`DELETE` on the same route, and derived from the signed-in session rather than
a caller-supplied user ID. `GET /api/my/follow-stats` supplies the current
member's follower and following totals, while `GET /api/my/followers` pages
only the active public identities represented by the follower total. Neither
private route exposes email, identity-provider, or session data. Private
responses are not cached and vary on the session cookie. The homepage uses the
follower total in **Your stats**; ingredient requests remain available in
member activity and their dedicated workspace.

## Private member libraries

The two private endpoints accept no user identifier. They derive the member
solely from the active Recipe Lab session, return `Cache-Control: private,
no-store`, and vary on the session cookie:

- `GET /api/my/recipes` requires `view=drafts|published|withdrawn`. Each view is
  filtered, sorted, counted, and paginated by the server. Drafts contains only
  active private drafts. Published contains `published` and
  `moderation_hidden` recipes with an accurate private `visibility_state`.
  Withdrawn contains only `author_withdrawn` recipes. The UI labels drafts as
  private, preserves direct-parent provenance where available, and provides the
  author-only withdraw/restore controls without calling each card separately.
- `GET /api/my/saved-recipes` database-pages only public versions currently
  saved by the current member, ordered by the server-recorded save time.

The matching member workspace is `/account/recipes?view=...`, with Drafts,
Published, Saved, and Withdrawn views. Saved continues to use its separate
private API contract, while the old `/account/saved-recipes` route redirects to
the Saved view for compatibility. The former `/account/recipe-drafts`
collection route redirects to the Drafts view while individual editor URLs
remain stable. Ingredient-request history is linked from this workspace rather
than exposed as a separate global account-menu destination.
Signed-out visitors use the existing account gate. One member cannot select
another member's drafts, authored-library entries, or saves by changing a query
parameter or URL because no such selector exists.

Recipe withdrawal and deletion do not add comments, messages, notifications,
public email, analytics, profile images, or a moderation queue.

## Verification contract

Backend coverage uses multiple members and a three-version cross-user chain to
prove exact-version author and direct-parent attribution. It also covers an
unpublished-parent/public-child edge, empty and unknown profiles, pagination,
private-library isolation, cache headers, recursive private-field exclusion,
and fixed query-count bounds as page size grows. Frontend unit and browser
coverage exercises public profile and private library loading, empty, error,
not-found, pagination, account gating, authorship labels, fork provenance,
keyboard access, responsive layouts, follow and unfollow behavior, follower
statistics, and the absence of per-card API fan-out.
