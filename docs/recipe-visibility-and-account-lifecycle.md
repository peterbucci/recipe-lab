# Recipe visibility and account lifecycle

RCP-30 adds reversible author withdrawal and irreversible member-account
deletion without weakening Recipe Lab's immutable publication and fork-history
contracts. A recipe snapshot never changes after publication. Visibility is a
separate lifecycle decision around that snapshot, and deleting an account
removes private identity and activity while retaining the minimum anonymous
author tombstone required by public recipe topology.

## Shared public-read boundary

Every public recipe adapter starts from the same database predicate: the exact
version must have a publication row whose effective state is `published`.
Browse, search, public cook profiles, recommendations, saved libraries, recipe
details, parent and child projections, interactions, fork-draft creation,
publication source checks, duplicate candidates, and diffs all use that seam.
Filtering after loading or scoring is not an acceptable substitute.

The canonical SQL predicates and effective-state precedence live together in
`app/policies/recipe_visibility.py`. Repositories and publication/moderation
services consume that policy boundary instead of defining local `published`
checks, so a future visibility state has one application-level read contract to
update.

The earlier repository and service compatibility re-exports have been removed
now that every maintained caller imports this policy boundary directly.
Migration history and stored visibility evidence are unchanged.

Publication rows support three effective states:

- `published`: anonymously readable and eligible for all public consumers;
- `author_withdrawn`: removed from public consumers by the version's author;
  and
- `moderation_hidden`: removed from public consumers by the separate moderation
  boundary introduced in RCP-31.

The current state retains independent author-withdrawal and moderation-hidden
timestamps. Moderation therefore does not erase an author's earlier withdrawal
choice: a future moderator restore can reveal a recipe only when the author
axis is also clear. State changes are serialized with publication and fork
creation, and database triggers append a visibility event while preventing
updates to immutable publication evidence.

## Author withdrawal and restoration

An active, onboarded member manages authored snapshots through My Recipes.
`GET /api/my/recipes?view=published` includes that member's published and
moderation-hidden versions, while `view=withdrawn` contains author-withdrawn
versions. Both add `visibility_state` to the private library entry. Public
recipe response objects do not expose lifecycle state.

`PUT /api/recipes/{recipe_version_id}/visibility` accepts one desired author
state:

```json
{ "state": "published" }
```

or:

```json
{ "state": "author_withdrawn" }
```

The request requires the member session, exact trusted Origin, and the
session-bound CSRF token. The version ID and persisted author determine
ownership; the request cannot nominate another actor. Repeating the same
desired state is safe. Missing and non-owned versions use the same opaque
not-found response. An author cannot restore a moderation-hidden snapshot.

Withdrawal does not delete or renumber a lineage. Public descendants remain
readable under their own authors. When their immutable `parent_version_id` is
known but the parent is unavailable, the nested parent is `null` and the UI
shows plain **Source unavailable** without a link, title, author, body, or
moderation detail. A direct request for a nonexistent, withdrawn, or
moderation-hidden recipe uses the same neutral unavailable response. Public
diffs never load an unavailable side.

Fork drafts may retain the stable ID of a source that is later withdrawn, but
publication rechecks the shared predicate while holding the publication guard
and source-lineage lock. If visibility changed, publication fails atomically
with `recipe_fork_source_unavailable`; the private draft remains intact and no
child, publication receipt, or fork signal is written.

## Recent authentication

Account deletion is more sensitive than an ordinary session mutation. Each
opaque application session records the provider's immutable `auth_time` when
the provider supplies it; otherwise this assurance remains unknown. Recipe Lab
never substitutes callback time for missing provider evidence. Normal request
activity updates `last_seen_at` but never extends the assurance.
`AUTH_RECENT_TTL_SECONDS` defines the short deletion window and defaults to ten
minutes.

When that window has expired, `DELETE /api/auth/account` returns
`403 recent_authentication_required`. The member starts
`GET /api/auth/reauthenticate?return_to=/account/settings`. This creates a
one-time, session-bound OIDC transaction and sends `prompt=login` plus
`max_age=0`. The callback requires the exact issuer/subject already bound to
the member and a fresh provider `auth_time`; a different account, missing or
stale evidence, an expired transaction, or a replay fails generically. A
successful check rotates the local session. Provider credentials and tokens
remain outside Recipe Lab.

## Account deletion and retained topology

`DELETE /api/auth/account` requires a recent authenticated session plus normal
Origin and CSRF evidence. Its JSON body also carries the exact current handle,
or `DELETE` when no handle exists; the server validates that phrase while the
member row is locked, so a caller cannot bypass confirmation by skipping the
settings page. The UI is available before onboarding is complete, requires an
explicit acknowledgement, and discloses the retention behavior before enabling
deletion. The operation commits once and then clears both authentication
cookies.

Deletion immediately makes every application session unusable and removes:

- the OIDC issuer/subject mapping and private email;
- the public handle and member-chosen display name;
- all session rows, saves, ratings, and preference events;
- active private drafts and their structured content;
- unresolved private catalog-request content and unreferenced private
  duplicate-review evidence; and
- any current curator grant held by the member.

Pending ingredient requests and their submission events are deleted. Reviewed
requests remain as catalog-governance evidence, but private request context is
removed from both the request and its submission event. Database guards allow
only those exact lifecycle erasures after the member is a complete tombstone;
review decisions and publication-bound duplicate evidence remain append-only.
Reports retain only their reason and case topology. A deleting moderator's
private decision note and replay fingerprint are replaced by fixed anonymous
values while the action and before/after state remain append-only.

The stable user UUID remains only as a constrained tombstone with status
`deleted`, no email or handle, a deletion timestamp, and display name
`Deleted cook`. Published recipe lineages, immutable versions, visibility, and
publication-bound audit evidence remain. A published snapshot that was public
stays public under unlinked **Deleted cook** attribution; an author-withdrawn
snapshot stays withdrawn permanently because no account remains to restore it.
Published source-draft rows required by immutable receipt foreign keys are
reduced to content-free shells rather than deleted. A later sign-up through the
same identity provider creates a distinct account and does not recover the old
handle, recipes, or activity.

## Privacy-safe failures and scope

Unavailable public reads never reveal the former title, body, author handle,
private account data, or moderation notes. The public deleted-cook reference
contains exactly stable user ID, `handle: null`, and `display_name: "Deleted
cook"`. Active member authors retain the same three-field contract with a real
handle. The fixed, non-login Demo Cook may also appear without a handle on
legacy public recipes, as plain text without a profile. Arbitrary handle-less
active identities fail closed. Cook-profile lookup still requires an active
handle, so the deleted member's old profile route is indistinguishable from an
unknown handle.

RCP-30 does not add report intake, moderation queues, unlisted sharing,
automated classification, cascading fork deletion, or hard deletion of
published snapshots. Those are separate product and governance decisions.
The exhaustive database, log, backup, and research-artifact rules are in
[account-data governance and deletion completeness](account-data-governance.md).
