# Recipe lifecycle

Recipe Lab preserves the exact recipe a cook published and the exact version
another cook adapted. It does this by separating stable recipe identity,
immutable published versions, cross-recipe lineage, and private mutable drafts.

This guide owns that lifecycle model. Ingredient, measurement, and cooking-step
structure is described in [Structured recipe data](reference/structured-data.md),
and similarity review is described in
[Recipe similarity](reference/recipe-similarity.md).

## The four recipe identities

| Concept | Purpose | Mutable? |
| --- | --- | --- |
| Lineage | Groups one original recipe and every separate recipe adapted from it | No ordinary topology rewrite |
| Recipe | Stable identity for one cook's recipe across its editions; selects one current version | Current pointer and active ownership are constrained lifecycle fields |
| Recipe version | One exact published content snapshot | No |
| Draft | One cook's private authoring aggregate | Yes, while active |

An adaptation and a revision are different relationships:

```text
Lineage L

Recipe A (Alice)                 Recipe B (Bob)
  A1 --previous--> A2              B1
   |                                ^
   +---------- exact source --------+

A1 and A2 are editions of the same stable recipe.
B1 is a separate recipe adapted from exact version A1.
```

`parent_version_id` records a cross-recipe adaptation source. It never moves
when Alice publishes A2. `previous_recipe_version_id` records immediate
same-recipe succession. A stable recipe's `current_recipe_version_id` chooses
the normal destination without changing the meaning of older exact links.

The older lineage-wide `version_number` remains part of stored topology but is
not the same as a recipe-local edition number. Application code does not infer
one relationship from the other.

## Private drafts

Drafts live in separate tables from published versions. Each declares one
intent at creation:

| Draft kind | Source | Publication result |
| --- | --- | --- |
| `original` | None | First edition of a new recipe in a new lineage |
| `adaptation` | One exact readable public version | First edition of a different recipe in the source lineage |
| `revision` | The readable current edition of a recipe owned by the member | Next edition of that same stable recipe |

The backend derives the author from the active Recipe Lab session. A request
cannot nominate another member. Adaptation and revision source checks are
performed by the backend; the frontend never decides whether a member owns a
recipe or may revise it.

### Incomplete work is valid private state

An active draft may have no ingredients or instructions, a blank title, no
servings, an ingredient without an amount, blank instruction prose, or steps
whose structured cooking details are unfinished. A partially specified typed
measure is still invalid: a draft stores either one complete measure or no
measure.

This flexibility does not weaken publication. Draft-only nullable and blank
states cannot be materialized into an immutable public version. Publication
requires a title, positive servings, complete catalog-backed ingredients and
amounts, instruction text, and the complete structured action graph.

Draft ingredients also distinguish a reviewed catalog selection from an
unresolved ingredient request. Request text is untrusted and cannot silently
become a public ingredient. Even after a curator approves or resolves a
request, the author must explicitly select the resulting catalog item in a new
draft revision.

### Creation, saving, and conflicts

Draft creation is idempotent. One opaque action key is bound to the member and
the exact intent: original, adaptation from a particular version, or revision
from a particular current edition. Repeating the same action returns the same
active draft. Reusing it for a different intent, or after that binding became a
discarded or published terminal shell, is a conflict.

The replay lookup occurs before the source is re-read. If the first response is
lost, the same action can recover the draft even if the source is withdrawn
later. A genuinely new creation action must pass current source visibility and
revision-authority checks.

A save atomically replaces the complete aggregate under an expected optimistic
revision and increments that revision once. A stale save returns a conflict and
does not merge or partly persist fields. The editor keeps local values so the
author can compare them with the latest saved version. The current publication
flow operates on a confirmed saved revision; draft persistence by itself never
publishes or creates public signals.

The author does not need to press Save before Publish. When the editor is dirty,
Publish first saves the exact draft, revision, and publication intent that
initiated the action. It opens publication review only if that same resource,
revision, and intent are still current when the save finishes. A save conflict
or an edit made while the request is in flight preserves the current local
values and keeps review closed; an asynchronous completion never acts on a
different draft that is now rendered.

### Discard and terminal state

Discard verifies the owner and expected revision, erases all private authored
content, and leaves a content-free hidden shell only to keep the creation
binding terminal. There is no trash, undo, or product restore path. Account
deletion removes unpublished shells because they have no public retention
purpose.

Successful publication retains a different content-free terminal draft shell
and its immutable receipt. It is not editable or listed as an active draft; it
exists so an exact retry can resolve the original result and cannot publish a
second version.

## Publication transaction

Publication crosses from private mutable state to immutable public history. It
is one backend-owned transaction, not a sequence of frontend writes.

Before publishing, the saved draft receives a revision-bound similarity
preflight. The review is mandatory, but its match is advisory. A distinct
result needs no decision; an exact, probable, or unchanged-source result
requires an explicit continue decision. Editing and saving invalidates the old
preflight. There is no publish-without-review fallback when the check is
unavailable.

The publication service locks and revalidates the member, active draft,
optimistic revision, draft kind, source, complete structured content,
fingerprint, preflight policy, result digest, candidate visibility, and any
required decision. It then performs the topology-specific transition:

- **Original:** create a lineage, stable recipe, parentless exact version, and
  edition one.
- **Adaptation:** recheck the exact source as publicly readable, lock its
  lineage, create a different stable recipe, and publish edition one with that
  source as its exact parent.
- **Revision:** lock the existing stable recipe, require the source still to be
  its readable current edition owned by the member, append the next edition,
  and advance current.

Every successful path also stages the complete ordered snapshot, its structural
fingerprint, initial visibility, immutable publication receipt, community-rules
and rights evidence, and terminal draft state. Adaptation adds exactly one fork
preference event from the direct source to the new version. Original and
same-recipe revision publication do not create a fork event.

A revision may carry the author's optional `correction` or `update` reason.
That is weak self-reporting, not a verified quality or safety claim. A declared
correction may request atomic withdrawal of its exact predecessor. The
successor, current-pointer change, and withdrawal then commit together.

If any check or write fails, no partial lineage, stable recipe, version,
edition, current pointer, fingerprint, receipt, event, visibility transition,
or terminal state survives. The active draft remains available unless the
successful transaction sealed it.

Publication has its own idempotency identity and canonical request fingerprint.
An exact replay returns the same exact published version and location. Changed
intent under the same key is rejected, and an uncertain client result is
recovered with the same key rather than by starting another publication.

## Immutable published content

A published version is an exact snapshot of metadata, categories, ingredient
occurrences and measures, instructions, structured actions, action inputs, and
parameters. Ordinary product paths cannot update or delete that content.

PostgreSQL constraints and triggers protect:

- exact source and lineage topology;
- stable-recipe membership and consecutive edition order;
- the current pointer selecting the latest edition of that recipe;
- ordered ingredient, instruction, action, and input graphs;
- structural fingerprints and publication evidence; and
- restrictive references from interactions and audit records.

The governing rule is:

> Published recipe content is immutable against ordinary product mutations,
> subject to legally required privacy or security operations.

No exceptional published-content mutation is currently implemented. Account
deletion, author withdrawal, and moderation change identity or visibility
around a snapshot; they do not rewrite its content.

## Exact, current, history, and comparison reads

An exact recipe-version read is a permalink. It does not redirect to or
substitute newer content. A stable current read resolves only the recipe's
explicit current pointer and never falls back to an older edition if current
is unavailable.

Browse, search, public profiles, community activity, recommendations, and
ordinary authored libraries select at most the readable current edition of a
stable recipe. A saved recipe is intentionally different: it remains pinned to
the exact version the member saved and may separately link to a readable newer
current edition.

Recipe history distinguishes same-recipe editions from adaptations. The
ordinary UI presents the direct relationships needed to understand the current
page rather than constructing an unbounded client-side lineage graph.

Comparison is a backend read over immutable snapshots. By default a version
compares with its direct parent; an explicit base may select another version in
the same lineage. The response groups metadata, ingredient, instruction, and
structured-action differences in deterministic order. The browser renders
that result and does not reconstruct authoring operations from row identifiers.
Fresh copied row IDs alone are not a change.

## Visibility

Visibility is separate from content and edition succession. Every public
consumer starts from the same effective policy. Supported states are:

- `published`: anonymously readable and eligible for public consumers;
- `author_withdrawn`: hidden by the exact version's author; and
- `moderation_hidden`: hidden through the community-moderation boundary.

Author withdrawal and moderation are independent axes. A moderator restore
cannot republish a version the author withdrew, and an author cannot restore a
moderation-hidden version. Transitions append audit evidence without changing
the snapshot.

Withdrawal does not delete descendants or renumber history. A public child may
retain a bare exact parent ID while its nested parent details are absent. The UI
shows a neutral unavailable source and does not reveal title, author, body, or
moderation details. Missing, withdrawn, and moderation-hidden direct reads use
the same non-disclosing unavailable boundary.

Publishing an adaptation rechecks source visibility. Publishing a revision
rechecks both source visibility and current-edition ownership. Source loss or a
stale current pointer fails atomically and leaves the private draft editable.

## Authorship and profiles

Each exact published version records its actual publishing member. The public
author projection contains only:

```json
{
  "id": "<stable Recipe Lab user UUID>",
  "handle": "cook_handle",
  "display_name": "Cook Name"
}
```

The handle is the public route key for an active cook; display name is
presentation text. Email, OIDC issuer and subject, sessions, saves, ratings,
events, and drafts are not public profile fields. Public parent attribution is
included only when that exact parent remains readable.

A cook profile lists only readable current versions authored by that cook and
may include a bounded plain-text description plus public follower and recipe
counts. Following grants no recipe or account access. A member cannot follow
themself, and deleting either account removes the relationship.

## Private libraries and interactions

My Recipes is a session-derived, server-filtered view of active drafts,
published recipes, and author-withdrawn recipes. Published includes an author's
moderation-hidden work so its true private state can be explained. Saved
Recipes contains only the current member's saves that still resolve to a
readable exact version. Counts are member-wide and independent of the current
page.

Private endpoints accept no member selector. They derive identity from the
session, return non-cacheable responses, and do not expose one member's library
by changing a URL parameter.

Saves and ratings are attached to exact versions. A member has at most one
active save and one rating per version; ratings are constrained to one through
five. View, save, rating, and adaptation events are append-only preference
history with member-and-operation-scoped idempotency keys. Duplicate-review
decisions are audit evidence, not preference signals.

## Account deletion

Account deletion requires a recent provider-backed authentication check and a
confirmed backend transaction. It removes OIDC mappings, sessions, private
email, public handle and chosen display name, saves, ratings, preference
events, follows, active drafts, unresolved private requests, and unreferenced
private workflow evidence.

Published history remains structurally valid. The stable user ID becomes a
constrained tombstone with no handle and fixed display name `Deleted cook`.
Public snapshots that were readable stay readable under that unlinked
attribution; author-withdrawn versions stay withdrawn because no account can
restore them. Stable recipes retain historical attribution and current
pointers but lose active owner authority, so the deleted account cannot publish
another edition. A later sign-up creates a distinct account and does not regain
the old recipes or activity.

The exact data-retention and privacy limits are documented in
[Security](security.md). Operational recovery does not turn deleted private
state into a user-facing restore feature.
