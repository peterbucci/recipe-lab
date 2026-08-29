# Private recipe drafts

Recipe Lab stores unfinished recipes in a private aggregate that is separate
from immutable public recipe versions. A signed-in, onboarded member can start
an empty original draft or copy one exact public recipe-version snapshot into a
fork draft, save it, resume it in another browser session, and discard it. A
saved source-less draft can also cross the explicit RCP-27 publication boundary
to become one immutable original root. RCP-28 lets a saved source-backed draft
cross the same reviewed boundary as a separate immutable child of its exact
public source.

## Private aggregate

`recipe_drafts` owns the member, optional exact source version, metadata,
lifecycle status (`active` or `published`), optimistic revision, and server
timestamps. Its child tables store ordered ingredient slots, instructions,
structured cooking actions, action inputs, and duration or temperature
measures. Draft actions may point only to ingredient slots in the same draft.

An ingredient slot has one of two explicit states:

- a catalog selection contains one curated ingredient identity, a verified
  canonical-or-alias display label, one typed quantity, an optional curated
  unit or package size when the quantity requires it, and optional preparation
  notes;
- an unresolved request uses an ingredient-catalog request owned by the same
  member as its only selection identity. It may retain a typed measure and
  preparation notes, but has no canonical ingredient ID or trusted display
  label and cannot be an action input.

The two states are never inferred from nullable identifiers. PostgreSQL foreign
keys and same-draft constraints prevent arbitrary ingredient, unit, action,
instruction, or occurrence identities from entering the aggregate. The API
also revalidates active authoring choices and canonical-or-alias labels. A fork
copy may retain an inactive historical catalog identity from its immutable
source; an author cannot select that inactive identity for new draft content.

Drafts can be incomplete. An empty original may have no ingredients or
instructions, and an instruction may retain prose before the author assigns
structured actions. These states are valid for private saving but are not a
claim that the draft is publishable.

## API and authorization

The private endpoints are:

- `POST /api/recipe-drafts` creates an empty original draft or copies the exact
  public snapshot named by an optional source-version ID;
- `GET /api/recipe-drafts` lists only the current member's active drafts;
- `GET /api/recipe-drafts/{draft_id}` reads only that member's active draft;
- `PUT /api/recipe-drafts/{draft_id}` atomically replaces the saved aggregate
  when the body's expected `revision` is current;
- `DELETE /api/recipe-drafts/{draft_id}?revision={expected}` permanently
  discards the current revision;
- `POST /api/recipe-drafts/{draft_id}/duplicate-preflights` reviews one saved
  original or fork revision for structural similarity; and
- `POST /api/recipe-drafts/{draft_id}/publish` atomically publishes one
  reviewed revision as an original root or direct fork child.

The server always selects authorship from the Recipe Lab session. Request
schemas accept no author or user identifier. Reads require an active member
session; mutations additionally require the session-bound CSRF token and a
trusted exact Origin. Every response containing draft data is private and
non-cacheable.

Draft creation additionally requires a UUID `Idempotency-Key`. The server
scopes that opaque action to the authenticated member and fingerprints the
versioned request body, whose only field is `source_version_id` with either
`null` or one lowercase UUID. Repeating the same action and
payload returns the same active draft; reusing it for a different source or for
a blank draft instead returns `409` and creates nothing. The replay lookup
happens before the source is read again, so an ambiguous first response can
recover its already-created private draft even when the public source is later
withdrawn or hidden. A new creation action against that unavailable source
still returns `404`.

Draft lookups are scoped by both stable draft ID and session member. A draft
owned by someone else is indistinguishable from a missing draft and returns
`404`, including update and discard attempts. Listing never computes an
unscoped total.

Each successful save increments the draft revision exactly once. A request
whose `revision` no longer matches returns `409` and changes nothing. This is an
optimistic conflict, not an automatic merge: the browser preserves its entered
values so the author can compare them with the newly loaded saved revision.

## Catalog-request resolution

Attaching an ingredient request preserves untrusted authoring state; it never
promotes the proposed text into `ingredients` or fabricates a canonical ID.
Pending and rejected request text remains untrusted. Approval or duplicate
resolution makes a reviewed catalog identity available, but does not silently
change a draft.

The author must explicitly select the reviewed resolution. That revision
replaces only the chosen unresolved slot with a validated catalog selection.
Metadata, quantities, preparation notes, instructions, actions, other request
references, and their order remain unchanged. Removing the request is also an
explicit author action. These rules keep request-status polling read-only and
make resolution safe to retry through normal revision handling.

## Public and recommendation boundary

Private drafts never use `recipe_versions` or its ingredient, instruction,
action, fingerprint, interaction, or lineage tables. Consequently they cannot
appear in:

- public browse, search, detail, lineage relationships, or diffs;
- public cook profiles or cards;
- duplicate-candidate results;
- recommendation candidates, member recommendation history, or support
  aggregates;
- saves, ratings, views, forks, or other preference events; or
- PostgreSQL exports used for offline recommendation evaluation.

Creating, saving, resuming, resolving, or discarding a draft appends no
`preference_events` row. The editor does not call recommendations,
substitutions, structural duplicate preflight, or a publication endpoint while
the member is merely authoring or saving. The explicit publish action crosses
this boundary only after a saved revision has completed similarity review.

This isolation is deliberate defense in depth. Public adapters use the shared
`recipe_version_publications` state predicate, while private content never
occupies `recipe_versions` at all. The publication adapter therefore cannot leak
a draft merely because another public query mishandles a visibility filter.

## Editor behavior

The unified editor uses the reviewed ingredient picker, atomic typed quantity
and unit controls, preparation notes, preserved instruction prose, and curated
structured-action controls. Ingredients, instructions, and actions have
keyboard-operable ordering controls; ordering is not drag-only.

**Save draft** is a private persistence action and never publishes. **Review
and publish** is available only for a clean, saved, structurally complete draft.
It first runs the required revision-bound similarity review, presents any
bounded public matches neutrally, and publishes a distinct result or an explicit
advisory continue. A fork also compares itself with its exact direct parent and
requires explicit acknowledgement when their canonical structures match.
Validation, stale evidence, and source-unavailable errors leave the entered form
values in place. After a confirmed save, that returned revision becomes the
clean baseline. A later edit is unsaved until another save succeeds and
completes a new review.

Leaving with changes relative to the last confirmed save produces a truthful
warning for reloads, closing the page, browser history navigation, and
client-side application links. A confirmed save or discard clears the warning;
a failed save does not.

Opening `/recipes/new` or an eligible `/recipes/{recipeVersionId}/fork` route
starts creation immediately after the member gate succeeds. There is no second
confirmation screen. While the request is in flight the page exposes a status,
and an ambiguous failure leaves a focused, retryable error without creating a
fresh intent. A definitive terminal-binding conflict retires that completed
attempt and makes one bounded request with a fresh key; if that request also
fails, the focused retry action starts from another fresh key. Once a valid
draft ID is known the browser replaces the starter route with the owner-only
editor route, so Back does not return to a creation page and silently create
another draft.

The browser keeps one bounded creation attempt in tab-scoped `sessionStorage`,
under
`recipe-lab:draft-creation-attempt:v1:<encoded actor>:<encoded intent>`. The
intent is `blank` or `source:<lowercase source UUID>`, and the exact stored
record is `{ actor_id, idempotency_key, intent, version: 1 }`. It therefore
contains only a schema version, actor ID, intent label, and opaque UUID; it
contains no recipe body, source title, cookie, or CSRF token. This lifetime
survives retry, reload, and a same-tab sign-in return, but ends when that tab's
session storage is cleared. The browser removes the attempt after it validates
a draft response and learns the stable draft ID, or after the server
definitively reports that the binding already belongs to a discarded or
published draft. An unknown outcome keeps the attempt so the next request does
not guess whether the first request committed. Blank creation and each exact
source use different browser intent scopes and server fingerprints, so
changing intent uses a different binding. Server-side member scoping remains
the authority for ownership and replay.

Server bindings have no wall-clock expiry while their draft row exists. An
active binding lives for the draft's authoring lifetime; discard keeps the
content-free terminal shell described below; publication keeps the completed
shell and receipt. Account deletion applies the narrower retention rules in
[account-data governance](account-data-governance.md). Browser-attempt expiry
therefore never authorizes reuse of a server-bound action.

## Discard and retention

Discard is immediate and irreversible in the live application database. After
the owner and expected revision are verified, one transaction deletes every
ingredient, instruction, action, and measure row; erases title, description,
and servings; and marks the remaining row `discarded`. It is removed from the
member's list and later reads, edits, and discards return `404`. Recipe Lab
provides no trash, undo, restore endpoint, or soft-deleted copy of the recipe
body.

The content-free discarded shell retains only bounded ownership, optional
source, stable-ID, revision, timestamp, status, and creation-binding evidence.
That evidence makes the original member/action binding terminal: replaying the
creation action returns `409` instead of silently creating another draft. An
automatic starter treats that exact terminal response as permission to retire
the browser key and begin one new creation intent; it never rotates a key for a
timeout, lost response, or other ambiguous failure. An account-deletion
transaction removes the member's discarded shells because they have no public
retention purpose.

Successful publication uses a different terminal policy. It retains the
completed draft with `status = published` and an immutable
`recipe_version_publications` receipt that binds the actor, idempotency action,
draft revision, duplicate-review evidence, public version, and publication
time. Published drafts are excluded from the active list, and ordinary draft
read, edit, and discard operations return `404`. The retained state is not a
second editable copy; its creation binding is terminal, and it exists to make
publication replayable and to prevent a second root or child from the same
draft.

Infrastructure backups, when configured, may retain database blocks according
to the bounded schedule in
[account-data governance](account-data-governance.md). They are not
browsable or recoverable through the product. RCP-26 does not prescribe that
schedule or claim that deleting a live row synchronously rewrites historical
backups; deployment operations must enforce backup protection, deletion replay,
and expiry before serving a restored copy.

## Publication boundary

The author first calls
`POST /api/recipe-drafts/{draft_id}/duplicate-preflights` with
`{ "revision": <saved_revision> }` and a UUID `Idempotency-Key`. The returned
preflight is immutable, actor-scoped, revision-bound, and limited to public
candidates. Similarity review is required but advisory. A distinct result can
publish with no decision; an exact or probable result can publish only when the
author explicitly chooses `continue`. Choosing revise means editing and saving
the draft, which invalidates the old review. The evidence describes structural
similarity only; it does not establish direct lineage, author intent, or a
cooking outcome. If review is unavailable, publication pauses and the saved
draft remains intact while the author retries. There is no
continue-without-review shortcut.

`POST /api/recipe-drafts/{draft_id}/publish` accepts the same saved revision and
the review envelope:

```json
{
  "revision": 4,
  "duplicate_review": {
    "preflight_id": "00000000-0000-4000-8000-000000000000",
    "policy_version": "recipe-duplicate-preflight-policy-v1",
    "result_digest": "<lowercase sha256>",
    "decision": null
  }
}
```

For an advisory match, `decision` is `"continue"`. The endpoint also requires
a UUID `Idempotency-Key`, the session-bound CSRF token, and trusted exact
Origin. The service reloads and locks the active author-owned draft and
revalidates its revision, complete curated structure, fingerprint, current
policy, optional exact source, result digest, public candidates, and required
decision. Client-supplied evidence alone is never trusted. A source-backed
preflight excludes the direct parent from ordinary candidate rows but separately
records `same_lineage_no_change` when their canonical structures match.

For a source-less draft, one transaction creates a new lineage and parentless
version-1 root attributed to the member on both rows. For a source-backed draft,
the transaction rechecks that its exact source is publicly readable, locks that
source's lineage, allocates the next lineage-wide version number, and creates a
separate child whose direct parent remains the source. Locking the lineage, not
only the selected parent, serializes siblings created concurrently from
different branches.

Both transitions create fresh ordered snapshot children, a fresh structural
fingerprint, published visibility and receipt, and the draft's terminal
`published` state. Original publication appends no fork or other preference
event. Fork publication atomically appends exactly one event whose member is the
authenticated publisher, source is the direct parent, and related version is
the child. The child version and receipt record that same publisher; the lineage
creator receives no rights over another member's descendant. This is durable
authorship evidence. RCP-29 exposes the resulting public version through the
author's profile and My Recipes while the retained completed draft remains
absent from active private-draft reads. See
[cook profiles and recipe libraries](cook-profiles-and-libraries.md).

Success returns `201`,
`{ "recipe_version_id": "<uuid>", "location": "/recipes/<uuid>" }`, and the
same path in `Location`. An exact retry of the same member action returns that
same response by looking up the stored publication result; it does not create a
second publication. A new idempotency key with the same completed intent also
uses the completed draft to find and return the same version. Changed intent or
key reuse returns `409`. If a fork's source is no longer public before
publication, the API returns
`409 recipe_fork_source_unavailable` and preserves the active private draft. Any
failure rolls everything back, so no partial lineage allocation, snapshot,
fingerprint, receipt, fork event, or completed state survives.

The published snapshot is immediately available through existing public
browse, detail, comparison, duplicate-candidate, and recommendation-candidate
reads. Later public-profile reads use the same publication-state seam. Its
lineage topology, root or child version, ordered content, structural fingerprint,
and publication receipt are immutable. Corrections require a new version rather
than mutation. A fork never moves into another lineage, changes its parent, or
rewrites its source. Neither publication path may reinterpret unresolved request
text as catalog identity.

## Verification boundary

Acceptance coverage includes owner-versus-other-member `404` behavior,
authentication and CSRF failures, stale-revision conflicts, exact fork copying,
arbitrary-identity rejection, request-status and resolution preservation,
discarded-content erasure, and private/non-signal exclusion. Publication
coverage adds original-versus-source-backed topology and owner checks,
revision and curated-identity revalidation, source-aware advisory review, explicit
direct-parent no-change acknowledgement, rollback on every failure, exact
idempotent replay, changed-intent conflict, source-loss preservation, one-root
or one-child enforcement, retained-draft sealing, public visibility, immutable
snapshot guards, and seeded-version backfill. A two-member integration proves
exact lineage and parent, publisher attribution, lineage-creator isolation,
exactly one fork event, concurrent sibling numbering, retry behavior, and the
direct-parent diff. Frontend and browser checks cover saved-session resume,
validation preservation, keyboard ordering, accessible error focus and
announcements, phone layouts, two-tab conflicts, both hard-navigation and
client-navigation unsaved-change warnings, source-loss recovery, and successful
publish navigation to the stable public location.

Creation-specific checks cover concurrent identical requests, changed-payload
conflicts, a lost response followed by retry with the same body and action, a
reload and same-tab sign-in return, replay after both author withdrawal and
moderator hiding, rejection of a new intent after either visibility change,
terminal replay after discard, keyboard activation of original and fork entry
points, phone layout, a loading-only intermediate state, focused retry, and the
absence of the removed confirmation control.
