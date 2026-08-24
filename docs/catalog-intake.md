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
not cacheable. A lookup or request failure leaves the in-browser recipe editor
unchanged. Cross-session private draft persistence remains a separate feature.

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

An operator grants access by stable user ID after verifying the intended
member:

```sql
INSERT INTO catalog_curators (user_id, granted_by_user_id)
VALUES ('member-uuid', 'granting-member-uuid')
ON CONFLICT (user_id) DO NOTHING;
```

For an initial operator-managed grant, `granted_by_user_id` may be null. Revoke
the grant by deleting only that member's row from `catalog_curators`; existing
request decisions and audit evidence remain protected by their foreign keys.

Curators use the private, paginated `GET /api/ingredient-requests` queue and
`POST /api/ingredient-requests/{request_id}/review`. Approval accepts only a
bounded canonical name, a bounded alias list, a decision reason, and
provenance. Rejection and duplicate decisions require a bounded reason.

This workflow does not let members create aliases, infer synonyms, bulk-import
catalog data, attach nutrition or safety claims, or moderate recipes generally.
