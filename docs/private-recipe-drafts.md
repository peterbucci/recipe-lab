# Private recipe drafts

Recipe Lab stores unfinished recipes in a private aggregate that is separate
from immutable public recipe versions. A signed-in, onboarded member can start
an empty original draft or copy one exact public recipe-version snapshot into a
fork draft, save it, resume it in another browser session, and discard it. This
workflow does not publish a recipe.

## Private aggregate

`recipe_drafts` owns the member, optional exact source version, metadata,
lifecycle status, optimistic revision, and server timestamps. Its child tables
store ordered ingredient slots, instructions, structured cooking actions,
action inputs, and duration or temperature measures. Draft actions may point
only to ingredient slots in the same draft.

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
  when the body's expected `revision` is current; and
- `DELETE /api/recipe-drafts/{draft_id}?revision={expected}` permanently
  discards the current revision.

The server always selects authorship from the Recipe Lab session. Request
schemas accept no author or user identifier. Reads require an active member
session; mutations additionally require the session-bound CSRF token and a
trusted exact Origin. Every response containing draft data is private and
non-cacheable.

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
the member is authoring.

This isolation is deliberate defense in depth. Several public adapters can
currently select every `RecipeVersion` because every row in that table is an
immutable public snapshot. Keeping private state in separate tables prevents a
future public adapter from leaking drafts merely because it omitted a status
predicate.

## Editor behavior

The unified editor uses the reviewed ingredient picker, atomic typed quantity
and unit controls, preparation notes, preserved instruction prose, and curated
structured-action controls. Ingredients, instructions, and actions have
keyboard-operable ordering controls; ordering is not drag-only.

**Save draft** is a private persistence action. It is distinct from **Publish
recipe**, which is not implemented by RCP-26. Validation and API errors leave
the entered form values in place. After a confirmed save, that returned
revision becomes the clean baseline. A later edit is unsaved until another save
succeeds.

Leaving with changes relative to the last confirmed save produces a truthful
warning for reloads, closing the page, browser history navigation, and
client-side application links. A confirmed save or discard clears the warning;
a failed save does not.

## Discard and retention

Discard is immediate and irreversible in the live application database. After
the owner and expected revision are verified, one transaction deletes the
draft and all child content. It is removed from the member's list and later
reads return `404`. Recipe Lab provides no trash, undo, restore endpoint, or
soft-deleted copy of the recipe body.

Infrastructure backups, when configured, may retain database blocks according
to the operator's separately documented backup schedule. They are not
browsable or recoverable through the product. RCP-26 does not prescribe that
schedule or claim that deleting a live row synchronously rewrites historical
backups; deployment operations must define backup protection and expiry.

## Publication boundary

RCP-26 does not create a lineage, immutable recipe version, structural
fingerprint, duplicate-preflight record, or fork event. It also does not mark a
draft published.

RCP-27 owns original-recipe publication. It must reload and lock the active
author-owned source-less draft, validate the complete catalog-backed structure,
run and bind the source-less duplicate preflight, create one lineage and root
snapshot atomically, and only then complete the draft lifecycle. A failed
publication must leave the draft editable.

RCP-28 owns fork publication. It must retain the draft's exact source-version
identity, recheck that source's public availability, allocate the child version
inside the source lineage, and record exactly one fork event. Neither story may
reinterpret unresolved request text as catalog identity.

## Verification boundary

Acceptance coverage includes owner-versus-other-member `404` behavior,
authentication and CSRF failures, stale-revision conflicts, exact fork copying,
arbitrary-identity rejection, request-status and resolution preservation,
discard deletion, and public/non-signal exclusion. Frontend and browser checks
cover saved-session resume, validation preservation, keyboard ordering,
accessible error focus and announcements, phone layouts, two-tab conflicts,
and both hard-navigation and client-navigation unsaved-change warnings.
