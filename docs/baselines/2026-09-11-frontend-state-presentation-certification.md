# RCP-50 frontend state presentation certification

Date: 2026-09-11

This record certifies the RCP-50 review candidate against the semantic state
contract. Every story remains on its topic branch and is merged only into
`codex/rcp-50-integration`; `main` remains unchanged pending review.

## Integrated stories

| Story | Topic branch | Completed scope |
| --- | --- | --- |
| RCP-50A | `codex/rcp-50a-state-foundation` | Added the domain-neutral route, retry, and pagination presentation primitives and their contracts. |
| RCP-50B | `codex/rcp-50b-access-states` | Normalized member and staff account states while preserving return locations and intentional staff concealment. |
| RCP-50C | `codex/rcp-50c-draft-states` | Gave canonical and compatibility draft routes one opaque, domain-owned state implementation. |
| RCP-50D | `codex/rcp-50d-route-states` | Migrated public retry, missing-resource, and out-of-range routes while preserving caller-owned recovery. |
| RCP-50E | `codex/rcp-50e-state-cleanup` | Removed obsolete state markup and CSS, aligned tests with semantic behavior, refreshed representative baselines, and recorded this certification. |

The integration history retains no-fast-forward merge boundaries for each
story. The topic branches remain independently reviewable and rollbackable.

## Final semantic mapping

| Semantic state | Owner | Announcement and recovery contract |
| --- | --- | --- |
| Missing or concealed | `StatePage` + `StatePanel` | Ordinary content with no retry. Use generic copy when disclosure is sensitive and useful domain copy otherwise. |
| Load failure | `RetryableStatePage` | Alert with retry and a caller-owned safe exit. Raw error details are never rendered. |
| Authentication required | `MemberRouteGate` | Ordinary content with sign-in that preserves the current return location. |
| Account-check failure | Member or staff retryable presentation | Alert with account/session refresh and the standard “We couldn't check your account” vocabulary. |
| Account setup required | `MemberRouteGate` | Ordinary content with a finish-setup action. |
| No permission | Direct staff concealment or domain-owned opaque state | Direct staff workspaces look missing; `/staff` explicitly reports no assigned tools; a foreign draft remains indistinguishable from a missing draft. |
| Out of range | `PaginationOutOfRange` + `WorkspaceEmptyState` | Ordinary content with no retry or pagination controls and a caller-owned valid page-one destination. |
| Partial failure | `WorkspaceErrorState` or feature-owned inline feedback | The failed section may retry without replacing the otherwise usable route. |

Ordinary empty content is a presentation scope, not a retryable failure reason.

## Consolidation and CSS ownership

The migration retired the old presentation hooks `system-state-*`,
`staff-state-*`, `catalog-state-page`, `catalog-state-panel`,
`public-context-state`, `blocking-error-state`,
`member-route-gate--shared-anonymous`,
`recipe-authoring-state--error`, `recipe-authoring-state--unavailable`,
`recipe-authoring-state--gate`, `catalog-results__empty--stale`, and
`draft-editor-page__loading`. Their CSS and markup selectors have no remaining
runtime use. The `system-state` name retained in the route-theme inventory is a
historical theme-family label, not a live selector.

`app/styles/features/system-staff-state.css` and its global import were deleted.
Base `.state-page*` and `.state-panel*` selectors now belong to
`app/styles/primitives.css`, including the `--wide` and `--large` modifiers.
The CSS architecture check reserves those families while allowing reviewed
feature-context selectors. Remaining `.empty-state` uses represent live domain
empty or terminal content rather than failed requests.

## Intentional specialized states

| Owner | Why it remains specialized | Preserved invariant |
| --- | --- | --- |
| Account Settings access and session state | Incomplete onboarding does not remove account-lifecycle controls. | A member can still reach account deletion and recovery. |
| Onboarding and authentication callback | These are form, redirect, and reauthentication transactions. | Values, focus, return destination, and transaction recovery remain intact. |
| New and fork draft starters | Their retry owns an idempotent mutation and stage-specific focus. | Retrying cannot create duplicate drafts or disclose a private identifier. |
| Draft editor save conflicts and session interruption | Recovery must remain inside the active editor. | Unsaved work is not unmounted by a route-level state. |
| Top-level `/staff` no-role state | The absence of assigned tools is safe and useful to disclose there. | Direct staff workspaces remain concealed. |
| `account/deleted` | This is terminal lifecycle confirmation. | It is not mislabeled as missing content or a load failure. |
| Home, workspace, recipe-family, staff-detail, and form states | These failures are section-scoped or inline. | The rest of the route stays usable. |
| Purpose-built loading skeletons | Loading preserves the expected page shape. | Loading is not represented as an error-taxonomy member. |

## Preserved behavior and disclosure

- Protected children render only after their access decision; sign-in preserves
  the requested route, and retry refreshes the account check.
- A concealed direct staff route uses the generic not-found body and performs no
  private feature fetch. Its client-gated document response is HTTP 200, while
  protected cross-role API reads return a generic 403 with no private payload.
- Malformed draft identifiers still use the framework not-found boundary.
  Missing and foreign valid drafts render the same body, expose neither owner
  nor raw identifier, and do not offer retry.
- Transient draft failures retain retry and an exit to My Recipes. Canonical and
  compatibility URLs reuse the same authoring implementation.
- Draft save-conflict and session-recovery behavior remains in place.
- Public load failures invoke the route reset callback and hide raw errors.
- Out-of-range recovery preserves applicable sort, filter, view, and cook-handle
  context while returning to a valid page one; pagination controls are hidden.
- Partial failures remain section-scoped and never replace a usable route.

## Representative visual and accessibility evidence

The deliberate RCP-50 evidence set is the new desktop
`catalog-page-out-of-range` baseline and refreshed desktop
`recipe-detail-error`, desktop `recipe-detail-unavailable`, and phone
`global-not-found` baselines. Each was reviewed at original resolution. The
visual cases include Axe and horizontal-overflow checks, and their exact Git
objects are bound by the source-package opaque-artifact policy.

The full pinned sweep also exposed two deterministic stale references unrelated
to the state migration: desktop `draft-similarity-publication-review` and phone
`staff-tools-normal` (whose case also records `staff-tools-moderator-selected`).
No product source for those normal surfaces changed in RCP-50. Repeated actuals
were byte-stable; expected, actual, and diff images were reviewed at original
resolution with no content, layout, accessibility, or privacy defect, so the
canonical references were repaired.

Visual verification used the pinned Linux/amd64 Playwright image
`sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac`,
Node 22.23.2, Playwright 1.62.1, and Chromium 151.0.7922.34.

## Recorded verification

| Check | Result |
| --- | --- |
| Full frontend unit and component suite | 176 files, 983 tests passed |
| Lint and type checks | ESLint and generated-route TypeScript checks passed |
| CSS contracts | Shared selector ownership and focused checker regressions passed |
| Architecture audit | 403 production source files passed |
| Reachability audit | 235 modules from 57 runtime entries passed |
| Production build | Next.js build completed with 19 of 19 static pages |
| Browser-mode discovery | Smoke 17, acceptance 23, performance 1, release 1, visual 172 |
| Pinned visual/accessibility double-run | 344 scheduled cases: 178 applicable checks passed and 166 deliberate project/viewport skips |
| Visual artifacts | 83 approved baseline PNGs; all 89 reviewed opaque artifacts are bound to exact Git objects |
| Source packaging | Packaging tests and committed-HEAD opaque-policy audit passed |
| Diff hygiene | `git diff --check` passed |

## Review boundary

Review the complete candidate as `main...codex/rcp-50-integration`. Do not merge
it to `main` until review and hosted workflow checks complete. RCP-50 issues
remain open until the review branch is accepted and merged.
