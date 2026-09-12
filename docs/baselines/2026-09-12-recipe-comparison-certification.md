# RCP-52 recipe-style comparison certification

Date: 2026-09-12

This record describes the RCP-52 review candidate assembled on
`codex/rcp-52-recipe-comparison-integration`. Each implementation pass is also
preserved on the topic branch listed below. `main` remains unchanged pending
review.

## Story map

| Story | Topic branch | Candidate scope |
| --- | --- | --- |
| RCP-52A | `codex/rcp-52a-comparison-read-model` | Compose one deterministic recipe-first comparison read model from the existing detail and diff contracts. |
| RCP-52B | `codex/rcp-52b-comparison-css-ownership` | Give comparison presentation one feature-owned stylesheet and an enforceable selector boundary. |
| RCP-52C | `codex/rcp-52c-comparison-hero-navigation` | Present the current recipe first and provide the standard Recipe, Notes, and Family tab experience. |
| RCP-52D | `codex/rcp-52d-comparison-ingredients` | Render the complete current ingredient list with inline added, removed, changed, and prior values. |
| RCP-52E | `codex/rcp-52e-comparison-instructions-notes` | Render complete cooking steps, structured actions, and notes with adjacent prior values, then separate written-step and cooking-breakdown changes with the standard instruction view control. |
| RCP-52F | `codex/rcp-52f-comparison-certification` | Remove the retired audit presentation and certify responsive, accessible, loading, print, and visual behavior. |

## Certified experience

The target recipe is authoritative for artwork, publication context, title,
source, description, categories, author, facts, ingredients, instructions, and
notes. The selected comparison base remains separately identified in the
comparison strip. One read model owns structured change classification,
ordering, prior-value association, and the overall change total.

Ingredients and instructions retain the complete current recipe in canonical
order. Added, removed, and changed rows use symbols and text in addition to
color. Changed current values use `ins`; their directly adjacent prior values
use `del`. Within Instructions, Steps owns title and wording changes, while
Cooking breakdown owns action, ingredient-use, ordering, timing, and
temperature changes. A modification that belongs only to the other view stays
neutral rather than striking through unchanged content. Structured instruction
actions retain their stored order, linked ingredient names, active state,
timing, and temperature without exposing internal identifiers. A zero-change
response still renders the complete recipe in both instruction views.

The comparison uses the same accessible Recipe, Notes, and Family tabs as the
normal recipe view. Recipe is the default panel and owns the ingredient and
instruction comparison. Current and previous note values appear only in Notes,
while Family provides the lineage navigator without leaving the comparison
route. The tabs retain canonical hashes for direct links and address-bar state.
Inside Recipe, the comparison uses the same compact Steps and Cooking breakdown
control as normal recipe reading and draft editing. This nested control is local
UI state and does not replace the comparison URL or its base-version query.

The existing route boundary continues to own invalid comparison queries,
concealed or missing recipes, recipes without a parent, ordinary service
failures, retry, and recovery. The comparison route remains server-rendered and
uses the existing API contracts; RCP-52 changes no backend, OpenAPI, database,
or migration file.

## Responsive and alternate-media contract

| Width or mode | Certified behavior |
| --- | --- |
| 1440 by 900 | Recipe hero and recipe body each use two columns; four facts and two recipe actions remain on one row. |
| 901 CSS pixels | Both primary grids remain two-column. |
| 900 CSS pixels | Both primary grids switch to one column at the documented boundary. |
| 820 by 1000 | Hero and body stay stacked without overflow while facts and recipe actions retain their intermediate layout. |
| 680 by 900 | Reader and comparison instruction headers stack while their shared switch fills the available width. |
| 390 by 844 | Hero, strip, actions, tabs, active-panel content, ingredient values, prior values, both instruction views, and notes reflow without horizontal overflow; the instruction switch becomes full width. |
| Forced colors | Both selected tab treatments, status symbols, text labels, insertion/deletion semantics, links, prior values, and step connectors remain distinguishable. |
| Print | Recipe, both instruction views, and Notes print with their prior-value context; both interactive tablists, the Family panel, and recipe actions leave the print flow. |

The keyboard journey establishes this relative focus order while allowing the
intentional source and author links between required stops: Explore breadcrumb,
View starting recipe, Back to current recipe, the selected Recipe tab, and the
selected Steps tab. Each tablist has its own wrapped Arrow, Home, and End roving
behavior. Recipe, Notes, and Family selection updates the accessible panel and
canonical hash; Steps and Cooking breakdown switch only their nested accessible
panel without changing the comparison route.

## Reviewed visual evidence

The three comparison-body PNGs affected by the instruction-view follow-up were
regenerated in the immutable Playwright image used by CI,
viewed at original resolution, and admitted to the opaque-source policy with
their Git object IDs. The unchanged phone-top image remains valid evidence for
the recipe-first hero.

| Project | Snapshot | Git object ID | Review purpose |
| --- | --- | --- | --- |
| Desktop | `recipe-comparison-normal` | `fd0737175390917a7eef26470949eb3579539304` | Recipe tab with the two-column complete ingredient comparison and default Steps view. |
| Desktop | `recipe-comparison-intermediate-normal` | `fabfa613ebbe201aff9d67102a20ba3c9edf8cc2` | Stacked 820 px Recipe panel, default Steps view, and prior values. |
| Phone | `recipe-comparison-top-normal` | `ecff7f01f82a17e7902b82554d50ef50931f8f5b` | Recipe-first phone hero and current recipe context. |
| Phone | `recipe-comparison-normal` | `75e7452cf84bf4a97684c711453a4128f41b7ae7` | Sticky standard tabs with the complete phone Recipe panel and full-width instruction switch. |

The canonical runner used:

```text
mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac
```

It reported Playwright 1.62.1 and Chromium 151.0.7922.34 on linux/amd64.

## Recorded verification

| Check | Result |
| --- | --- |
| Focused comparison and route-state components | 27 affected-component tests passed; the complete frontend suite passed 186 files and 1,023 tests. |
| Frontend architecture and reachability | Architecture audited 423 source files with no retired-location violations; reachability found 245 modules from 58 runtime entries. |
| CSS architecture | Current comparison and loading selector families have one enforced owner; retired audit selector families are absent. |
| Responsive and accessibility contracts | Reviewed-width, exact 901/900 boundary, forced-colors, print, Axe, and horizontal-overflow checks passed. |
| Current-branch comparison browser smoke | Desktop and phone comparison journeys cover full content, adjacent prior values, both nested instruction views, independent roving keyboard focus, canonical hashes, and phone overflow. |
| Full pull-request browser smoke | All 17 Chromium and engine-sanity checks passed against a dedicated current-branch frontend. |
| Guarded comparison acceptance | Both affected real-stack publication journeys passed against a fresh isolated database: 2 passed in 23.8 seconds; the fixture, backend process, and database were removed afterward. |
| Browser-mode discovery | Smoke 17, acceptance 23, performance 1, release 1, and visual 184 tests were discovered. |
| Locked repository gates | Repository policy, architecture dependencies, documentation links, OpenAPI snapshot, seed data, generated API contracts, Python formatting/lint/types, frontend lint/types, CSS architecture, unit tests, reachability, build, and browser discovery passed. |
| Production build | Next.js production build and its TypeScript phase passed; 20 static pages generated. |
| Pinned visual/accessibility double-run | 190 checks passed with 178 deliberate cross-project skips in the immutable Linux/Chromium image. |
| Stateful release assertion compatibility | The comparison assertions in the guarded release journey were migrated to the inline-diff contract and passed lint and TypeScript checks; the full release operator remains owned by its isolated OIDC/database workflow. |
| Opaque-source and production-image policy | 76 packaging and production-image tests plus 54 parameterized subtests passed; this follow-up binds the three updated comparison PNG object IDs. |
| Diff hygiene | `git diff --check` passed. |

## Cleanup boundary

The comparison page no longer renders the audit overview, highlights, grouped
change cards, or audit-specific empty state. Their obsolete selector families
and the unused test helper are removed. The dedicated route loading skeleton
mirrors the recipe hero, tabs, legend, and default two-column Recipe panel;
its instruction column now previews the nested two-option switch. Note changes
belong to the Notes panel. The unreachable generic comparison loading variant
is removed.

## Review boundary

Review the completed candidate as
`main...codex/rcp-52-recipe-comparison-integration`. Do not merge it to `main`
until its hosted checks have passed and the changes have been reviewed.
