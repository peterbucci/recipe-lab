# Reachability and compatibility inventory

This is the reviewed final reachability inventory for the refactor branch. It
separates source reachability from lifecycle policy: an import proves that code
can execute, while a link, redirect initiator, maintained workflow, or explicit
compatibility decision explains why the surface exists.

The four lifecycle classes are:

- **active** — a current member/public workflow consumes the surface;
- **internal** — a framework, authentication, staff, operator, or research
  workflow consumes it;
- **compatibility-only** — no current navigation depends on it, but an explicit
  legacy path is retained for old bookmarks or callers;
- **retired** — removal was explicitly approved and no live executable surface
  remains.

Repository searches cannot establish the absence of callers outside the
repository. Backend external-consumer status therefore remains
`unknown_pending`, and no deployed API operation was removed in this audit.

## Frontend page routes

`frontend/route-theme-inventory.ts` is the machine-checked source of this table.
Its test recursively discovers every App Router `page.tsx`, requires an exact
one-to-one inventory, verifies evidence paths, and locks the three compatibility
redirects and their targets.

| Route | Lifecycle | Concrete in-repository evidence |
| --- | --- | --- |
| `/` | active | `frontend/app/components/site-header.tsx` links to the signed-in home; the page conditionally redirects anonymous visits to `/recipes`. |
| `/account/activity` | active | `frontend/app/components/member-home-summary.tsx` links to the complete activity view. |
| `/account/community-activity` | active | `frontend/app/components/home-community-feed.tsx` links its View all action here. |
| `/account/deleted` | internal | `frontend/app/components/account-settings.tsx` navigates here after confirmed deletion. |
| `/account/followers` | active | `frontend/app/components/member-home-summary.tsx` links the follower count here. |
| `/account/ingredient-requests` | active | `frontend/app/components/account-menu.tsx` links to the member request workspace. |
| `/account/recipe-drafts/[draftId]` | compatibility-only | `docs/architecture.md` records the former editor address; the route validates the ID and redirects to `/recipes/drafts/[draftId]`. |
| `/account/recipe-drafts` | compatibility-only | `docs/cook-profiles-and-libraries.md` records the legacy collection path; it redirects to `/account/recipes?view=drafts`. |
| `/account/recipes` | active | `frontend/app/components/account-menu.tsx` and member dashboard links target the unified library. |
| `/account/saved-recipes` | compatibility-only | `docs/cook-profiles-and-libraries.md` records the old saved-library path; it redirects to `/account/recipes?view=saved`. |
| `/account/settings` | active | `frontend/app/components/account-menu.tsx` links to account settings. |
| `/auth/callback` | internal | `frontend/server/api-proxy.ts` redirects sanitized provider failures to this presentation route. |
| `/catalog/ingredient-requests` | internal | `frontend/app/components/staff-tools.tsx` links authorized curators to this workspace. |
| `/community-rules` | active | `frontend/app/components/recipe-draft-publication.tsx` links the required publication acknowledgement. |
| `/cooks/[handle]` | active | `frontend/app/components/public-cook-attribution.tsx` links public author attribution. |
| `/moderation/recipes` | internal | `frontend/app/components/staff-tools.tsx` links authorized moderators to this workspace. |
| `/onboarding` | internal | `frontend/app/api/[...path]/route.ts` forwards the backend authentication completion redirect here. |
| `/recipes` | active | `frontend/app/components/site-header.tsx` links the public recipe catalog. |
| `/recipes/[recipeVersionId]` | active | `frontend/app/components/recipe-card.tsx` links every public catalog card to recipe detail. |
| `/recipes/[recipeVersionId]/compare` | active | `frontend/app/components/recipe-family-navigator.tsx` builds the selected-version comparison link. |
| `/recipes/[recipeVersionId]/fork` | active | `frontend/app/components/recipe-member-actions.tsx` builds the make/continue-version link. |
| `/recipes/drafts/[draftId]` | active | `frontend/app/components/recipe-draft-starter.tsx` navigates newly created drafts to the canonical editor. |
| `/recipes/new` | active | `frontend/app/components/site-header.tsx` links the create-recipe action. |
| `/sign-in` | active | `frontend/app/components/account-menu.tsx` links anonymous members and preserves the return path. |
| `/staff` | internal | `frontend/app/components/account-menu.tsx` links members with staff capabilities to the tool index. |

There are 16 active, six internal, and three compatibility-only page routes.
No executable page is classified as retired. Next configuration defines no
additional redirects or rewrites. The only page-level redirects are the three
compatibility routes above and the intentional anonymous `/` to `/recipes`
product redirect.

## Backend HTTP operations

`backend/app/openapi_contract.py` is the fail-closed machine-readable inventory.
Each operation below has stable identity, detailed consumer classification,
lifecycle classification, checked-in evidence, and external status in
`backend/openapi.json`. Runtime validation compares the registry with every
executable FastAPI route, including schema-excluded routes.

| Operation | Lifecycle | Detailed class | Concrete evidence |
| --- | --- | --- | --- |
| `DELETE /api/auth/account` | active | `active_consumer` | `frontend/lib/auth-api.ts` |
| `GET /api/auth/callback` | active | `active_consumer` | `frontend/lib/auth-api.ts`; `frontend/app/api/[...path]/route.ts` |
| `GET /api/auth/login` | active | `active_consumer` | `frontend/lib/auth-api.ts` |
| `POST /api/auth/logout` | active | `active_consumer` | `frontend/lib/auth-api.ts` |
| `GET /api/auth/reauthenticate` | active | `active_consumer` | `frontend/lib/auth-api.ts` |
| `GET /api/auth/session` | active | `active_consumer` | `frontend/lib/auth-api.ts` |
| `PATCH /api/auth/session/profile` | active | `active_consumer` | `frontend/lib/auth-api.ts` |
| `GET /api/cooking-action-types` | active | `active_consumer` | `frontend/lib/cooking-action-api.ts` |
| `GET /api/cooks/{handle}` | active | `active_consumer` | `frontend/lib/recipe-library-api.ts` |
| `DELETE /api/cooks/{handle}/follow` | active | `active_consumer` | `frontend/lib/member-follow-api.ts` |
| `GET /api/cooks/{handle}/follow` | active | `active_consumer` | `frontend/lib/member-follow-api.ts` |
| `PUT /api/cooks/{handle}/follow` | active | `active_consumer` | `frontend/lib/member-follow-api.ts` |
| `GET /api/health` | internal | `staff_internal` | `docs/operations-observability.md` |
| `GET /api/ingredient-requests` | internal | `staff_internal` | `frontend/lib/ingredient-catalog-api.ts`; curator workspace |
| `POST /api/ingredient-requests` | active | `active_consumer` | `frontend/lib/ingredient-catalog-api.ts` |
| `GET /api/ingredient-requests/mine` | active | `active_consumer` | `frontend/lib/ingredient-catalog-api.ts` |
| `GET /api/ingredient-requests/{request_id}` | active | `active_consumer` | `frontend/lib/ingredient-catalog-api.ts` |
| `GET /api/ingredient-requests/{request_id}/review` | internal | `staff_internal` | `frontend/lib/ingredient-catalog-api.ts`; curator workspace |
| `POST /api/ingredient-requests/{request_id}/review` | internal | `staff_internal` | `frontend/lib/ingredient-catalog-api.ts`; curator workspace |
| `GET /api/ingredients` | active | `active_consumer` | `frontend/lib/ingredient-catalog-api.ts` |
| `GET /api/measurement-units` | active | `active_consumer` | `frontend/lib/measurement-unit-api.ts` |
| `POST /api/measurements/convert` | internal | `research_experimental` | `docs/measurements.md` |
| `GET /api/moderation/recipe-reports` | internal | `staff_internal` | `frontend/lib/recipe-moderation-api.ts`; moderator workspace |
| `GET /api/moderation/recipe-reports/{recipe_version_id}` | internal | `staff_internal` | `frontend/lib/recipe-moderation-api.ts`; moderator workspace |
| `POST /api/moderation/recipe-reports/{recipe_version_id}/actions` | internal | `staff_internal` | `frontend/lib/recipe-moderation-api.ts`; moderator workspace |
| `GET /api/my/activity` | active | `active_consumer` | `frontend/lib/member-activity-api.ts` |
| `GET /api/my/community-activity` | active | `active_consumer` | `frontend/lib/member-follow-api.ts` |
| `GET /api/my/dashboard` | active | `active_consumer` | `frontend/lib/member-activity-api.ts` |
| `GET /api/my/followers` | active | `active_consumer` | `frontend/lib/member-follow-api.ts` |
| `GET /api/my/follow-stats` | active | `active_consumer` | `frontend/lib/member-follow-api.ts` |
| `GET /api/my/recipes` | active | `active_consumer` | `frontend/lib/recipe-library-api.ts` |
| `GET /api/my/saved-recipes` | active | `active_consumer` | `frontend/lib/recipe-library-api.ts` |
| `GET /api/readiness` | internal | `staff_internal` | `docs/operations-observability.md` |
| `GET /api/recipe-categories` | active | `active_consumer` | `frontend/lib/recipe-api.ts` |
| `GET /api/recipe-drafts` | active | `active_consumer` | `frontend/lib/recipe-draft-api.ts` |
| `POST /api/recipe-drafts` | active | `active_consumer` | `frontend/lib/recipe-draft-api.ts` |
| `DELETE /api/recipe-drafts/{draft_id}` | active | `active_consumer` | `frontend/lib/recipe-draft-api.ts` |
| `GET /api/recipe-drafts/{draft_id}` | active | `active_consumer` | `frontend/lib/recipe-draft-api.ts` |
| `PUT /api/recipe-drafts/{draft_id}` | active | `active_consumer` | `frontend/lib/recipe-draft-api.ts` |
| `POST /api/recipe-drafts/{draft_id}/duplicate-preflights` | active | `active_consumer` | `frontend/lib/recipe-duplicate-api.ts` |
| `POST /api/recipe-drafts/{draft_id}/publish` | active | `active_consumer` | `frontend/lib/recipe-publication-api.ts` |
| `GET /api/recipes` | active | `active_consumer` | `frontend/lib/recipe-api.ts` |
| `GET /api/recipes/featured` | active | `active_consumer` | `frontend/lib/recipe-api.ts` |
| `GET /api/recipes/viewer-states` | active | `active_consumer` | `frontend/lib/interaction-api.ts` |
| `GET /api/recipes/{recipe_version_id}` | active | `active_consumer` | `frontend/lib/recipe-api.ts` |
| `GET /api/recipes/{recipe_version_id}/diff` | active | `active_consumer` | `frontend/lib/recipe-api.ts` |
| `DELETE /api/recipes/{recipe_version_id}/rating` | active | `active_consumer` | `frontend/lib/interaction-api.ts` |
| `PUT /api/recipes/{recipe_version_id}/rating` | active | `active_consumer` | `frontend/lib/interaction-api.ts` |
| `POST /api/recipes/{recipe_version_id}/reports` | active | `active_consumer` | `frontend/lib/recipe-report-api.ts` |
| `DELETE /api/recipes/{recipe_version_id}/save` | active | `active_consumer` | `frontend/lib/interaction-api.ts` |
| `PUT /api/recipes/{recipe_version_id}/save` | active | `active_consumer` | `frontend/lib/interaction-api.ts` |
| `POST /api/recipes/{recipe_version_id}/view` | active | `active_consumer` | `frontend/lib/interaction-api.ts` |
| `PUT /api/recipes/{recipe_version_id}/visibility` | active | `active_consumer` | `frontend/lib/recipe-visibility-api.ts` |
| `GET /api/recommendations` | internal | `research_experimental` | `docs/recommendations.md` |

The four framework-owned surfaces (`/docs`, `/docs/oauth2-redirect`,
`/openapi.json`, and `/redoc`, each GET/HEAD) are separately inventoried as
internal with `docs/api-contracts.md` as their operator evidence. The registry
contains 44 active and ten internal OpenAPI operations. It contains no live
compatibility-only or retired operation.

Three retired, pre-deployment-only adapters remain absent and are guarded by
contract tests: `POST /api/recipes/{recipe_version_id}/variants`,
`POST /api/recipes/{recipe_version_id}/duplicate-preflights`, and
`POST /api/recipe-duplicate-preflights/{preflight_id}/decision`. Their removal
does not remove duplicate evidence, decisions, scoring, lineage, or publication
audit data.

## Source and compatibility cleanup result

`npm run reachability:check` parses static imports, re-exports, literal dynamic
imports, and CommonJS requires with the repository's locked TypeScript compiler.
Starting from every supported Next.js App Router
convention entry plus `server.mjs`, it walks production modules under `app`,
`lib`, and `server` and fails when a module is unreachable. Tests, configuration,
generated declarations, and CSS selectors are outside that deliberately narrow
check rather than being guessed at heuristically.

The audit identified and removed one unreachable module,
`app/components/recipe-search.tsx`, plus its selectors. The maintained header
and catalog search paths use different components. No other production module
in the checked graph was unreachable.

The following ambiguous or intentionally compatible surfaces remain:

- the three frontend redirect routes, because old bookmarks and previously
  shared URLs cannot be disproved by repository search;
- every backend operation, because external-consumer status is
  `unknown_pending` even when its current in-repository role is internal;
- the singular duplicate-scoring export consumed by the separate `ml` package;
- snapshot-v1 ingredient-ID fields consumed by offline evaluation; and
- historical migrations, legacy measurement audit tooling, evidence tables,
  publication receipts, duplicate decisions, and account-data governance
  contracts.

CSS outside the removed component-specific selectors is retained. Conditional
class names, responsive states, and browser-only states make whole-repository
selector deletion unsafe without runtime coverage; absence from a simple text
search is not accepted as proof.

## Change policy

An added or moved page must update the exact frontend inventory and name
evidence. An added backend route must update the exact executable/OpenAPI
registry, stable operation ID, evidence, lifecycle metadata, snapshot, and
generated frontend types in the same reviewed change. Removal requires more
than an empty repository search: external status must be resolved or an explicit
pre-deployment/deprecation decision must be recorded. Historical migrations and
evidence/audit contracts are not cleanup candidates.
