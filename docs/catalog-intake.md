# Ingredient catalog intake and review

Recipe Lab keeps trusted ingredient identities separate from member-authored
text. A recipe edit can publish only an existing `ingredients.id` together with
a canonical name or reviewed alias that belongs to that exact row. The server
revalidates both values; a browser selection is never trusted on its own.

## Catalog selection

`GET /api/ingredients` is a public, bounded, paginated lookup over canonical
names and reviewed aliases. Search terms are treated as literal text, including
percent and underscore characters. Each ingredient appears at most once and
returns its stable ID, canonical name, and sorted reviewed aliases.

The recipe editor keeps its search text separate from its selected catalog
object. Typing does not create a hidden ingredient value. Add and replace edits
submit `ingredient_id` plus `display_name`, and publication fails atomically if
the ID is missing or the label is not a canonical name or alias for that ID.
Choosing a reviewed alias therefore preserves the catalog-backed wording while
all identity-based features continue to use the canonical ID.

## Missing-item requests

A signed-in, onboarded member can submit a proposed name and optional short
context with `POST /api/ingredient-requests`. The request is stored in
`ingredient_catalog_requests`, never in `ingredients` or `ingredient_aliases`.
It is consequently absent from catalog search and cannot participate in a
recipe, substitution, or recommendation.

Members can read only their own request history and status through
`GET /api/ingredient-requests/mine` and
`GET /api/ingredient-requests/{request_id}`. These responses are private and
not cacheable. History is paginated with a maximum page size of 100 and accepts
optional `status` and literal `q` filters; counts and results remain scoped to
the signed-in member. Member search covers their proposed names and current
resolved catalog names or aliases, never curator-only approval snapshots.
Requests owned by another member are omitted from history and indistinguishable
from a missing request by ID.

Approved and duplicate responses include `resolved_ingredient`, using the same
stable ID, canonical name, and reviewed-alias contract as catalog search. That
nested catalog object is the trusted value an editor may select. The original
`proposed_name` remains untrusted even after review. Pending and rejected
responses have no resolved ingredient, so their text can never silently become
a recipe ingredient. A lookup or request failure leaves the in-browser recipe
editor unchanged. Cross-session private draft persistence remains a separate
feature.

Requests move once from `pending` to one of these terminal states:

- `approved`: the transaction created a reviewed canonical ingredient and any
  explicitly reviewed aliases;
- `rejected`: no catalog identity was created;
- `duplicate`: the request points to an existing ingredient, directly or
  through an already approved request.

Every terminal decision records the requester, curator, review time, bounded
reason, and resolved ingredient when one exists. Approval also snapshots the
reviewed canonical name, aliases, and bounded provenance. Submission and
decision events are written to the append-only
`ingredient_catalog_audit_events` table in the same transaction.

## Duplicate and concurrency policy

Every catalog writer checks canonical names, aliases, and pending requests
before it adds trusted data. Unicode compatibility normalization, whitespace
folding, and case folding produce a conservative comparison candidate; they do
not create an ingredient, attach an alias, or silently select an identity.
Only an explicit curator approval or a validated seed-catalog entry can
establish catalog identity.

PostgreSQL transaction-scoped advisory locks serialize normalized name checks
for both curator approvals and seed loads. A seed may reuse only the existing
case-insensitive, outer-trimmed label identity; a compatibility-only or
internal-whitespace match is reported as a candidate conflict. A partial unique
index is a second guard against two pending requests for the same normalized
candidate. Catalog approval rechecks canonical and alias names while holding
the same locks, so a collision or concurrent decision rolls back the
ingredient, aliases, request transition, and audit event together.

## Curator authorization

Review endpoints require an active, onboarded member session, normal CSRF and
Origin evidence for mutations, and a row in `catalog_curators`. The grant is
narrow: it authorizes ingredient-catalog review only and is never inferred from
an email address, handle, or account creation order.

An operator with backend database credentials grants or revokes access by the
member's stable UUID. Granting requires the target to exist as an active,
onboarded member. Safe lookup and inventory commands help the operator find
that UUID and discover grants that need revocation:

```powershell
cd backend
python -m app.catalog_curators eligible
python -m app.catalog_curators eligible --query <uuid-handle-or-display-name> --limit 20
python -m app.catalog_curators list --limit 100
python -m app.catalog_curators grant --user-id <member-uuid>
python -m app.catalog_curators grant --user-id <member-uuid> --granted-by-user-id <grantor-uuid>
python -m app.catalog_curators revoke --user-id <member-uuid>
```

`eligible` searches an optional literal query against only stable UUID, handle,
and display name. It returns active, onboarded members and identifies which
already hold the narrow role. `list` returns current grants even when a holder
has since been suspended, deleted, or left onboarding incomplete, keeping every
grant discoverable for revocation. Its output includes the grant timestamp and
optional `granted_by_user_id` attribution. Both commands have deterministic
ordering, default limits, and an enforced maximum of 100 rows. Their JSON output
contains only stable UUID, handle, display name, eligibility/curator flags, and
the grant fields just described. They never search or expose email addresses,
OIDC identities, or session data.

The installed `recipe-lab-curator` command accepts the same subcommands and
arguments. Grant and revoke are idempotent: repeating an existing grant or an
already completed revocation exits successfully without changing data.
Revocation remains available after a member becomes ineligible, and it leaves
existing request decisions and append-only audit evidence intact.

`granted_by_user_id` is audit attribution only. It records the member associated
with the decision when one exists; it does not authorize the command, confer a
role, or permit self-promotion. Possession of the configured operator/database
access is the authorization boundary for every role-management command.

These commands use the configured `DATABASE_URL` and are the only supported
role-management interface. The application exposes no HTTP self-promotion or
general administration route, and email, handle, or account order never imply
curator access.

Curators use the private, paginated `GET /api/ingredient-requests` queue and
`POST /api/ingredient-requests/{request_id}/review`. Approval accepts only a
bounded canonical name, a bounded alias list, a decision reason, and
provenance. Rejection and duplicate decisions require a bounded reason. The
decision reason is member-visible and must not contain private reviewer notes
or personal information; approval provenance remains curator-only audit data.

This workflow does not let members create aliases, infer synonyms, bulk-import
catalog data, attach nutrition or safety claims, or moderate recipes generally.
