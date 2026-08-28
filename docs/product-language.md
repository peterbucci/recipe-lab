# Product language and recommendation boundary

Recipe Lab's public promise is deliberately small:

> Find recipes, make your own version, compare what changed, and follow recipe
> history.

That sentence describes the product that cooks can use today. The repository
also contains an API-only deterministic ranking baseline and offline research
experiments, but neither is a consumer recommendation feature.

## Preferred cook-facing terms

Use the words a cook needs to understand the action or relationship. Keep
implementation and data-model vocabulary out of ordinary screens.

| When the product means | Say | Avoid on ordinary screens |
| --- | --- | --- |
| A recipe the member made from another recipe | **Your version** or **version** | fork, child, variant |
| The direct recipe that a version started from | **Based on** or **starting recipe** | parent ID, source snapshot |
| The relationship among published versions | **Recipe history** | lineage, topology |
| Possible structural matches before publication | **Similar recipes** or **similarity review** | duplicate candidates, fingerprint matches |
| A reviewed ingredient available to members | **Approved ingredient** or **catalog name** | canonical ID, canonical identity |
| A published record that cannot be edited in place | **Published version** and **cannot be edited** | immutable snapshot, immutable child/root |

Use **This version** when referring to the recipe currently on screen and
**Another version** for related recipes. Explain consequences directly: for
example, “Publishing creates a separate public version and does not change the
starting recipe.”

## Claims that are not product copy

Until a separately reviewed consumer recommendation surface ships, ordinary
screens, metadata, onboarding, sign-in, screenshots, and public positioning
must not promise or imply:

- recommendations or suggestions shaped by a member's activity;
- that Recipe Lab “remembers what worked”;
- learned substitutions;
- personal intelligence; or
- outcome-based recommendations.

The same rule applies to close paraphrases such as “picked for you,” “tailored
to your cooking,” or claims that the product learns a member's tastes. A future
consumer surface needs its own privacy, exposure, latency, accessibility, and
failure-handling work before this language can change.

Ordinary member screens also must not expose UUIDs, canonical IDs, ingredient
occurrence IDs, policy versions, structural fingerprints, or immutable-snapshot
terminology. Error and empty states follow the same rule.

## Staff, diagnostics, and engineering exceptions

Exceptions are narrow and contextual, not a license to reuse internal language
in member copy:

- The curator-only ingredient-request workspace may use **canonical name**,
  **canonical identity**, provenance, and request identifiers because those are
  the objects being reviewed.
- Staff moderation and diagnostic views may show a bounded case or request
  identifier when it is necessary to investigate or operate the system.
- API schemas, code identifiers, migrations, architecture documents, tests of
  those contracts, and operator documentation may use exact technical terms.
- The recommendation endpoint and offline evaluation documents may use model
  and ranking terminology only when they label the work **research preview** or
  **experimental**, state that no consumer recommendation surface exists, and
  do not present offline results as shipped product behavior.

Public screenshots remain sanitized even when they capture a staff-only view.
No exception permits session material, identity-provider data, private member
activity, or account-derived identifiers in retained test artifacts.

## Research-preview data boundary

`GET /api/recommendations` is an API-only research preview. Its online
`baseline-v1` behavior is deterministic and is not a learned strategy. Every
request uses aggregate ratings, active saves, and distinct-member version and
view activity for publicly readable recipes. When a member is signed in, the
request-time calculation additionally reads only that member's current saves,
ratings, and privacy-bounded preference events. A signed-out request loads no
account-specific history.

The response is marked `private, no-store`; Recipe Lab does not persist a
recommendation result, recommendation profile, or online model artifact. The
underlying member activity remains governed as product data and is deleted with
the account. Observed-member model snapshots and derived reports remain
prohibited in application-managed and production environments. See
[baseline recommendation research](recommendations.md) and
[account-data governance](account-data-governance.md) for the complete scoring,
deletion, backup, and derived-artifact rules.

Offline `content-v1`, `collaborative-v1`, `hybrid-v1`, and substitution work is
engineering research. Deterministic online `baseline-v1` behavior remains
supported for API compatibility and evaluation, but offline learned strategies
must never be described as serving cooks or as shipped product features.

## Review checklist

Before merging public-copy changes, verify that:

1. the claim names a capability a cook can use now;
2. the preferred terms above are used consistently across normal, loading,
   empty, error, and expired-session states;
3. sign-in, onboarding, home, metadata, README copy, tests, and visual baselines
   do not imply a consumer recommendation experience;
4. IDs and internal workflow terms are absent from ordinary member screens;
5. any staff or diagnostic exception is explicit and remains access-controlled;
   and
6. research endpoints stay labeled as research preview and preserve the data
   boundary above.

The frontend policy test inventories ordinary UI modules automatically and
keeps staff-only exceptions explicit. It is intentionally a terminology guard,
not a substitute for copy review or rendered accessibility testing.
