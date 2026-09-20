# Private recipe drafts

Recipe Lab stores unfinished recipes in a private aggregate that is separate
from immutable public recipe versions. Each draft declares one intent:

- `original` starts without a source and publishes the first edition of a new
  stable recipe in a new lineage;
- `adaptation` copies one exact readable public version and publishes the first
  edition of a different stable recipe in that source's wider lineage; and
- `revision` copies one exact readable current edition of a stable recipe owned
  by the active member and publishes the next edition of that same recipe.

All three remain private and mutable while the cook saves, resumes, and tests
them. Copying a source never changes that source. Publication creates a fresh
immutable exact version; a revision advances a stable recipe's current pointer
instead of reinterpreting an older exact version.

## Private aggregate

`recipe_drafts` owns the member, explicit `draft_kind`, optional exact source
version, metadata, lifecycle status (`active` or `published`), optimistic
revision, and server timestamps. An original has no source; an adaptation or
revision must have one. Draft kind, rather than the presence of a source alone,
determines which publication workflow applies. Its child tables store ordered
ingredient slots, instructions, structured cooking actions, action inputs, and
duration or temperature measures. Draft actions may point only to ingredient
slots in the same draft.

An ingredient slot has one of two explicit states:

- a catalog selection contains one curated ingredient identity, a verified
  canonical-or-alias display label, an optional unfinished amount while the
  recipe remains private, and optional preparation notes. Once entered, an
  amount is one complete typed quantity with a curated unit or package size
  when that quantity requires it;
- an unresolved request uses an ingredient-catalog request owned by the same
  member as its only selection identity. It may retain a typed measure and
  preparation notes, but has no canonical ingredient ID or trusted display
  label and cannot be an action input.

The two states are never inferred from nullable identifiers. PostgreSQL foreign
keys and same-draft constraints prevent arbitrary ingredient, unit, action,
instruction, or occurrence identities from entering the aggregate. The API
also revalidates active authoring choices and canonical-or-alias labels. A
source copy may retain an inactive historical catalog identity from its
immutable source; an author cannot select that inactive identity for new draft
content.

Drafts can be incomplete. An empty original may have no ingredients or
instructions; a selected ingredient may still have no amount; and an
instruction may have blank prose or retain prose before the author assigns
structured actions. A partly entered amount is still invalid because the
private aggregate stores either a complete typed measure or no measure. These
states are valid for private saving but are not a claim that the draft is
publishable. Publication requires every ingredient amount and instruction text
in addition to the other public-recipe invariants.

## API and authorization

The private endpoints are:

- `POST /api/recipe-drafts` requires `draft_kind` and the matching exact
  `source_version_id`: null for an original, and present for an adaptation or
  revision;
- `GET /api/recipe-drafts` lists only the current member's active drafts;
- `GET /api/recipe-drafts/{draft_id}` reads only that member's active draft;
- `PUT /api/recipe-drafts/{draft_id}` atomically replaces the saved aggregate
  when the body's expected `revision` is current;
- `DELETE /api/recipe-drafts/{draft_id}?revision={expected}` permanently
  discards the current revision;
- `POST /api/recipe-drafts/{draft_id}/duplicate-preflights` reviews one saved
  original, adaptation, or same-recipe revision for structural similarity; and
- `POST /api/recipe-drafts/{draft_id}/publish` atomically publishes one
  reviewed draft according to its stored kind.

The server always selects authorship from the Recipe Lab session. Request
schemas accept no author or user identifier. Reads require an active member
session; mutations additionally require the session-bound CSRF token and a
trusted exact Origin. Every response containing draft data is private and
non-cacheable.

Draft creation additionally requires a UUID `Idempotency-Key`. The server
scopes that opaque action to the authenticated member and fingerprints the
version-2 request body containing both `draft_kind` and `source_version_id`.
Repeating the same action, kind, and exact source returns the same active draft;
reusing the key for another kind or source returns `409` and creates nothing.
The replay lookup happens before the source is read again, so an ambiguous first
response can recover its already-created private draft even when the source is
later withdrawn, hidden, or no longer current. A new adaptation action against
an unavailable source returns `404`; a new revision action also requires that
the exact source is the readable current edition owned by the active member.
Another cook receives the same opaque not-found result and must use an
adaptation instead.

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

## Recipe document materialization

Draft creation, complete draft replacement, and immutable publication share one
typed `RecipeDocument` content boundary. A public-source adapter preserves the
source graph's explicit ordering while refreshing the current curated unit
labels expected by an editable draft. The saved-draft adapter preserves the
stored labels and canonical measurement inputs used by the publication
fingerprint. The mutable materializer also preserves draft-only blank amounts
and instruction text; the immutable materializer rejects those incomplete
states. Both preallocate every locally referenced UUID and stage each graph as
a batch, so they do not need an insert-and-flush loop for ingredients,
instructions, or actions.

Materializers do not flush, commit, or catch database failures. Draft and
publication services own those transaction boundaries. Replacement first
removes the instruction/action graph, then the independent ingredient and
category rows, before staging the replacement document. Publication stages one
fresh immutable graph after allocating its lineage and version identity. A
failure at any checkpoint rolls back the entire application transaction and
cannot expose a partial draft or public version.

## Editor behavior

The unified editor uses the reviewed ingredient picker, atomic typed quantity
and unit controls, preparation notes, preserved instruction prose, and curated
structured-action controls. Ingredients, instructions, and actions have
keyboard-operable ordering controls; ordering is not drag-only.

**Save draft** is a private persistence action and never publishes. The normal
same-recipe action is **Publish changes**; original and adaptation drafts keep
their existing publish language. Publication is available only for a clean,
saved, structurally complete draft. It first runs the required revision-bound
similarity review, presents any bounded public matches neutrally, and publishes
a distinct result or an explicit advisory continue. An adaptation also compares
itself with its exact source and requires explicit acknowledgement when their
canonical structures match. A revision may record the author's optional
`correction` or `update` reason. That declaration is weak self-reporting: it
does not determine topology or prove correctness, safety, or cooking success.
Validation, stale evidence, and source-unavailable errors leave the entered
form values in place. After a confirmed save, that returned optimistic revision
becomes the clean baseline. A later edit is unsaved until another save succeeds
and completes a new review.

Leaving with changes relative to the last confirmed save produces a truthful
warning for reloads, closing the page, browser history navigation, and
client-side application links. A confirmed save or discard clears the warning;
a failed save does not.

Opening `/recipes/new`, an eligible `/recipes/{recipeVersionId}/fork` route, or
**Edit recipe** on an owned current edition starts the matching creation intent
immediately after the member gate succeeds. The UI never guesses revision
authority: it waits for the authenticated backend `can_revise` decision, shows
**Edit recipe** only when allowed, and otherwise keeps **Make your own version**.
There is no second confirmation screen. While the request is in flight the page
exposes a status, and an ambiguous failure leaves a focused, retryable error
without creating a fresh intent. Revision and adaptation requests have separate
resource identities, cancellation, and recovery state, so an older completion
cannot open a draft for whichever recipe happens to be rendered later. A
definitive terminal-binding conflict retires that completed attempt and makes
one bounded request with a fresh key; if that request also fails, the focused
retry action starts from another fresh key. Once a valid draft ID is known the
browser replaces the starter state with the owner-only editor, so Back does not
silently create another draft.

The browser keeps one bounded creation attempt in tab-scoped `sessionStorage`,
under
`recipe-lab:draft-creation-attempt:v2:<encoded actor>:<encoded intent>`. The
intent is `original`, `adaptation:source:<lowercase source UUID>`, or
`revision:source:<lowercase source UUID>`, and the exact stored record is
`{ actor_id, idempotency_key, intent, version: 2 }`. It therefore
contains only a schema version, actor ID, intent label, and opaque UUID; it
contains no recipe body, source title, cookie, or CSRF token. This lifetime
survives retry, reload, and a same-tab sign-in return, but ends when that tab's
session storage is cleared. The browser removes the attempt after it validates
a draft response and learns the stable draft ID, or after the server
definitively reports that the binding already belongs to a discarded or
published draft. An unknown outcome keeps the attempt so the next request does
not guess whether the first request committed. Each kind and exact source use a
different browser intent scope and server fingerprint, so changing from
revision to adaptation cannot reuse or clear the other request. Server-side
member scoping remains the authority for ownership and replay.

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

The content-free discarded shell retains only bounded ownership, explicit
draft kind, optional exact source, stable ID, revision, timestamp, status, and
creation-binding evidence.
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
draft kind and revision, duplicate-review evidence, exact public version, and
publication time. Published drafts are excluded from the active list, and ordinary draft
read, edit, and discard operations return `404`. The retained state is not a
second editable copy; its creation binding is terminal, and it exists to make
publication replayable and to prevent a second publication from the same draft.

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
    "policy_version": "recipe-duplicate-preflight-policy-v2",
    "result_digest": "<lowercase sha256>",
    "decision": null
  },
  "declared_change_reason": "correction",
  "withdraw_predecessor": true
}
```

For an advisory match, `decision` is `"continue"`. The declared reason is null
for an original or adaptation and may be `"correction"`, `"update"`, or null
for a revision. `withdraw_predecessor` may be true only for a declared
correction. The endpoint also requires a UUID `Idempotency-Key`, the
session-bound CSRF token, and trusted exact Origin. The service reloads and
locks the active author-owned draft and revalidates its kind, optimistic
revision, complete curated structure, fingerprint, current policy, exact
source, result digest, public candidates, and required decision. Client-supplied
evidence alone is never trusted. A source-backed preflight excludes its exact
source from ordinary candidate rows but separately records
`same_lineage_no_change` when their canonical structures match.

The stored draft kind selects one concrete transaction:

- an original creates a new lineage, a new stable recipe, and its parentless
  first exact version;
- an adaptation rechecks its exact source's public visibility, locks the source
  lineage, creates a different stable recipe in that lineage, and retains the
  exact source in `parent_version_id`; and
- a revision locks publication policy and the existing stable recipe, verifies
  that its exact source is still the readable current edition owned by the
  active member, appends the next recipe-local edition with
  `previous_recipe_version_id` set to that source, leaves
  `parent_version_id` null, and advances current in the same transaction.

Lineage-wide legacy version numbers remain separate from recipe-local edition
numbers. A stale revision source returns `409 recipe_revision_source_stale` and
leaves the losing draft active and editable. The stable-recipe lock and database
constraints allow only one competing successor to advance current.

Every successful path creates a fresh ordered snapshot, structural fingerprint,
published visibility row and receipt, and the draft's terminal `published`
state. Original and revision publication append no fork preference event. A
revision's append-only `RecipeEdition` relation, optional weak declared reason,
and immutable receipt are its publication evidence. Adaptation publication
atomically appends exactly one fork event whose member is the authenticated
publisher, source is the exact parent, and related version is the new child.
That event is observational evidence of adaptation, not proof that either
recipe was cooked or successful. The version and receipt record the same
publisher; the lineage creator receives no rights over another member's stable
recipe. RCP-29 exposes the resulting public version through the author's
profile and My Recipes while the retained completed draft remains absent from
active private-draft reads. See
[cook profiles and recipe libraries](cook-profiles-and-libraries.md).

A correction may withdraw its exact predecessor in the same publication
transaction. Failure rolls back both the successor and withdrawal. This safety
option never mutates the predecessor and never restores a moderation-hidden
source; moderator restore also cannot erase a prior author withdrawal.

Success returns `201`,
`{ "recipe_version_id": "<uuid>", "location": "/recipes/<uuid>" }`, and the
same exact-version path in `Location`. The separately explicit stable current
destination is `/recipes/current/<recipe-id>`; it is not publication evidence.
An exact retry of the same member action returns the stored exact version and
cannot advance current twice. A new idempotency key with the same completed
intent also returns that version. Changed intent or key reuse returns `409`.
If an adaptation's source is no longer public before publication, the API
returns `409 recipe_fork_source_unavailable` and preserves the active private
draft. Any failure rolls everything back, so no partial lineage allocation,
snapshot, stable recipe, current pointer, edition, fingerprint, receipt, fork
event, withdrawal, or completed state survives.

The current published edition is immediately available through public browse,
stable detail, duplicate-candidate, profile, and recommendation-candidate reads.
Exact detail, history, and comparison continue to address a readable exact
version without substituting newer content. Every public read uses the same
publication-state seam. Published recipe content is immutable against ordinary
product mutations, subject to legally required privacy or security operations.
Ordinary corrections therefore append a version and may change visibility; an
adaptation never moves into another lineage, changes its exact parent, or
rewrites its source. No publication path may reinterpret unresolved request
text as catalog identity.

## Verification boundary

Acceptance coverage includes owner-versus-other-member `404` behavior,
authentication and CSRF failures, stale optimistic-save conflicts, exact source
copying, arbitrary-identity rejection, request-status and resolution
preservation, discarded-content erasure, and private/non-signal exclusion.
Publication coverage adds all three draft kinds, owner-current authorization,
curated-identity revalidation, source-aware advisory review, explicit
same-structure acknowledgement, rollback, exact idempotent replay,
changed-intent conflict, source-loss preservation, stable-recipe and edition
constraints, retained-draft sealing, public visibility, immutable snapshot
guards, and deterministic legacy backfill. Two-member integration proves exact
adaptation source and publisher attribution; same-recipe integration proves
current advancement, stale-concurrency recovery, correction withdrawal,
moderation precedence, and the absence of revision-as-fork signals. Frontend
unit coverage protects saved-session resume, validation preservation, keyboard
ordering, accessible error focus and announcements, resource-scoped async
completion, auth recovery, and unsaved-change warnings. Browser, responsive,
Axe, forced-colors, and visual checks remain release evidence to run against the
final integrated candidate; unit coverage alone is not a browser pass.

Creation-specific checks cover concurrent identical requests, changed-payload
conflicts, a lost response followed by retry with the same body and action, a
reload and same-tab sign-in return, replay after both author withdrawal and
moderator hiding, rejection of a new intent after either visibility change,
terminal replay after discard, keyboard activation of original and adaptation
entry points, phone layout, a loading-only intermediate state, focused retry,
and the absence of the removed confirmation control. Revision creation adds
separate kind-and-source identity, backend-owned authorization, and stale-current
recovery to that contract.
