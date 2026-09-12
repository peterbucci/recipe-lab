# RCP-52 recipe-style comparison certification

Date: 2026-09-12

This record describes the RCP-52 review candidate assembled on
`codex/rcp-52-recipe-comparison-integration`. Each implementation pass is also
preserved on the topic branch listed below. `main` remains unchanged pending
review.

## Story map

| Story | Topic branch | Candidate scope |
| --- | --- | --- |
| RCP-52A | `codex/rcp-52a-comparison-read-model` | Compose one deterministic recipe-first comparison read model from the detail and comparison contracts. |
| RCP-52B | `codex/rcp-52b-comparison-css-ownership` | Give comparison presentation one feature-owned stylesheet and an enforceable selector boundary. |
| RCP-52C | `codex/rcp-52c-comparison-hero-navigation` | Present the current recipe first and provide the standard Recipe, Notes, and Family tab experience. |
| RCP-52D | `codex/rcp-52d-comparison-ingredients` | Render the complete current ingredient list with inline added, removed, changed, and prior values. |
| RCP-52E | `codex/rcp-52e-comparison-instructions-notes` | Render complete cooking steps, a semantically aligned structured-action list, and notes with adjacent prior values, then separate written-step and cooking-breakdown changes with the standard instruction view control. |
| RCP-52F | `codex/rcp-52f-comparison-certification` | Remove the retired audit presentation and certify responsive, accessible, loading, print, and visual behavior. |

## Certified experience

The target recipe is authoritative for artwork, publication context, title,
source, description, categories, author, facts, ingredients, instructions, and
notes. Categories are compared by stable category identity: current categories
stay in target-recipe order, additions are green, unchanged categories stay
white, and removed categories follow in base-recipe order with red strikethrough
text. Visible `+` and `−` markers and insertion/deletion semantics preserve this
meaning without relying on color. Category additions and removals each
contribute to the overall change total. The selected comparison base remains
separately identified in the comparison strip. One read model owns structured
change classification, ordering, prior-value association, and the overall
change total.

Ingredients and instructions retain the complete current recipe in canonical
order. Added, removed, and changed rows use symbols and text in addition to
color. Changed current values use `ins`; their directly adjacent prior values
use `del`. Within Instructions, Steps owns title and wording changes, while
Cooking breakdown owns action, ingredient-use, ordering, timing, and
temperature changes. A modification that belongs only to the other view stays
neutral rather than striking through unchanged content. Structured instruction
actions retain their stored order, linked ingredient names, active state,
timing, and temperature without displaying internal identifiers. The diff
contract supplies comparison-local `before_id` and `after_id` references for
exactly matched actions through each modified instruction's required
`unchanged_action_pairs` field. This lets the read model identify semantic
matches even though immutable recipe snapshots regenerate their action and
ingredient-occurrence row IDs. A zero-change response still renders the
complete recipe in both instruction views.

Changed Cooking breakdown values use full-width action cards modeled on the
normal recipe view. Each instruction has one ordered, aligned action list:
semantically unchanged actions appear once on white, additions appear on green,
and removals appear on red. When an action stays the same but its details
change, it appears once in a purple `±` row: unchanged fragments retain normal
text, removed details are red and struck through, and inserted details are
green. Visible `+`, `−`, and `±` markers, plus screen-reader-only Added,
Removed, and Changed text with `ins` and `del` semantics, preserve that meaning
without relying on color. The numbered step markers and their vertical
connector remain visible in Cooking breakdown just as they do in Steps.

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
uses an additive diff-response contract for exact unchanged-action matches.
RCP-52 changes the backend schema, diff service, OpenAPI snapshot, and generated
frontend API types, but does not change the database or add a migration.

## Responsive and alternate-media contract

| Width or mode | Certified behavior |
| --- | --- |
| 1440 by 900 | Recipe hero and recipe body each use two columns; four facts and two recipe actions remain on one row. |
| 901 CSS pixels | Both primary grids remain two-column. |
| 900 CSS pixels | Both primary grids switch to one column at the documented boundary. |
| 820 by 1000 | Hero and body stay stacked without overflow while facts and recipe actions retain their intermediate layout. |
| 680 by 900 | Reader and comparison instruction headers stack while their shared switch fills the available width. |
| 390 by 844 | Hero, strip, actions, tabs, active-panel content, ingredient values, prior values, both instruction views, and notes reflow without horizontal overflow; the instruction switch becomes full width, the numbered timeline remains visible, and action-card details move below their ingredient column. |
| Forced colors | Both selected tab treatments, status symbols, text labels, insertion/deletion semantics, links, prior values, numbered step connectors, and all four action states remain distinguishable; removed action rows retain a dashed boundary and changed rows retain a double boundary. |
| Print | Recipe, both instruction views, and Notes print with their prior-value context; both interactive tablists, the Family panel, and recipe actions leave the print flow. Cooking breakdown rows drop their color fills but retain the numbered timeline, borders, labels, and insertion/deletion semantics. |

The keyboard journey establishes this relative focus order while allowing the
intentional source and author links between required stops: Explore breadcrumb,
View starting recipe, Back to current recipe, the selected Recipe tab, and the
selected Steps tab. Each tablist has its own wrapped Arrow, Home, and End roving
behavior. Recipe, Notes, and Family selection updates the accessible panel and
canonical hash; Steps and Cooking breakdown switch only their nested accessible
panel without changing the comparison route.

## Reviewed visual evidence

The comparison references were refreshed in the immutable Playwright image used
by CI, inspected at original resolution, and bound to the opaque-source policy
with their Git object IDs. The default Steps references show recipe-style
ingredient checkboxes, the legend tucked beneath the section tabs, status beside
the current step title, field-only prior values, change pills below the prior
box, and an unbroken numbered timeline. The dedicated Cooking breakdown
references retain the aligned action-card treatment and connected timeline at
desktop, intermediate, and phone widths. The category-diff follow-up refreshes
only the two desktop references whose visible total changes from five to seven
and the phone-top reference that directly shows green `+ Dinner`, neutral
`Vegetarian`, and red struck-through `− Lunch` pills. The intermediate and
scrolled phone-body references remain pixel-valid.

The title-and-description follow-up adds an above-fold desktop reference and
refreshes the phone hero. Changed current metadata uses compact purple rows with
a visible `±` marker, while each prior value uses a slim red `Previous` strip
with a visible `−` marker and deletion semantics. Field-specific status and
prior-value context remain available to assistive technology without lengthening
the visible labels. At phone width, the complete author row remains above the
fixed navigation. The upstream hero geometry also deterministically rerasterized
the six scrolled Steps and Cooking breakdown references, including the two
intermediate-width references caught by the merged-branch CI run;
original-resolution review confirmed that their content and layout are
unchanged.

| Project | Snapshot | Git object ID | Review purpose |
| --- | --- | --- | --- |
| Desktop | `recipe-comparison-top-normal` | `81619d8eaabc98e7daa2923f9c626729ecd580b8` | Above-fold metadata comparison with compact purple current title and description rows, slim red prior-value strips, and color-independent markers. |
| Desktop | `recipe-comparison-normal` | `703cfd6a0833cc52634a62c399c48987fdecc1e8` | Two-column Recipe tab with category additions/removals included in the seven-change total, ingredient checkboxes, a close legend, status beside the step title, a wording-only prior box, and a connected timeline. |
| Desktop | `recipe-comparison-cooking-breakdown` | `8754afdd76079296354933a666867960f08f5354` | Seven-change total plus a connected numbered Cooking breakdown timeline with one aligned list of neutral, added, removed, and purple modified actions. |
| Desktop | `recipe-comparison-intermediate-normal` | `727f360a07666f709cc22e57011d20a7d6706efc` | Stacked 820 px Recipe panel with checkboxes, field-only prior values, labels after the prior box, and an unbroken timeline. |
| Desktop | `recipe-comparison-intermediate-cooking-breakdown` | `5b91cbaebb5eba80600e85590aa10bc0e2ff88bc` | Full-width aligned Cooking breakdown rows, inline detail changes, and a connected numbered timeline in the stacked 820 px layout. |
| Phone | `recipe-comparison-top-normal` | `70daf9776fe9f1b08662a28a7f53178e6dfad303` | Compact title and description diffs, category additions/removals, and the complete author row above the fixed navigation. |
| Phone | `recipe-comparison-normal` | `a2c86c57cbac7e143275d91de65bda61e32a8456` | Sticky standard tabs with checkboxes, title-adjacent status, field-only prior values, labels below the prior box, and a connected timeline. |
| Phone | `recipe-comparison-cooking-breakdown` | `a286db7f99ebcc4417d7857f72a069ed7671f9b3` | Connected numbered timeline, two-column aligned action rows, stacked timing, and all four action states without horizontal overflow. |

The canonical runner used:

```text
mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac
```

It reported Playwright 1.62.1 and Chromium 151.0.7922.34 on linux/amd64.

## Recorded verification

| Check | Result |
| --- | --- |
| Focused comparison and route-state components | The focused comparison suite passed 10 files and 44 tests; the complete frontend suite passed 186 files and 1,028 tests. |
| Frontend architecture and reachability | Architecture audited 424 source files with no retired-location violations; reachability found 245 modules from 58 runtime entries. |
| CSS architecture | Current comparison and loading selector families have one enforced owner; retired audit selector families are absent. |
| Responsive and accessibility contracts | Reviewed-width, exact 901/900 boundary, forced-colors, print, Axe, and horizontal-overflow checks passed. |
| Current-branch comparison browser smoke | Desktop and phone comparison journeys cover full content, adjacent prior values, both nested instruction views, color-independent neutral/added/removed/modified Cooking breakdown rows, the numbered timeline, independent roving keyboard focus, canonical hashes, and phone overflow. |
| Full pull-request browser smoke | All 17 Chromium and engine-sanity checks passed against a dedicated current-branch frontend. |
| Guarded comparison acceptance | Both affected real-stack publication journeys passed against a fresh isolated database: 2 passed in 23.8 seconds; the fixture, backend process, and database were removed afterward. |
| Browser-mode discovery | Smoke 17, acceptance 23, performance 1, release 1, and visual 184 tests were discovered. |
| Locked repository gates | Repository policy, architecture dependencies, documentation links, OpenAPI snapshot, seed data, generated API contracts, Python formatting/lint/types, frontend lint/types, CSS architecture, unit tests, reachability, build, and browser discovery passed. |
| Production build | Next.js production build and its TypeScript phase passed; 20 static pages generated. |
| Pinned visual/accessibility double-run | 190 checks passed with 178 deliberate cross-project skips in the immutable Linux/Chromium image. |
| Pinned comparison visual refresh | Before promotion, each default-view mismatch repeated with an identical pixel count and byte-identical actual PNG. Exactly six requested comparison-body references were regenerated and inspected at original resolution; the post-update targeted double-run passed 12 checks with 12 deliberate cross-project skips, including the responsive boundary, forced-colors, print, Axe, overflow, and timeline-geometry assertions. |
| Pinned category-comparison visual follow-up | A staged pre-update double-run was needed because the first stale screenshot stops its enclosing test before the later Cooking breakdown capture. It proved exactly three deterministic changes: desktop Steps (21 pixels twice), desktop Cooking breakdown (21 pixels twice), and phone top (689 pixels twice); both repeat captures were byte-identical. Only those three PNGs were promoted and inspected at original resolution. The post-update comparison double-run passed 12 checks with 12 deliberate cross-project skips, including the unchanged intermediate and phone-body references plus boundary, forced-colors, print, Axe, overflow, and category semantics. |
| Pinned title-and-description visual follow-up | The pre-update double-run reported the expected new desktop-top reference twice and a deterministic 11,219-pixel phone-top change twice; the repeated phone actuals were byte-identical. Six references were promoted after original-resolution review: the two direct hero references and four scrolled Steps/Cooking breakdown rerasterizations caused by upstream hero geometry, with no body redesign. The post-update targeted double-run passed 12 checks with 12 deliberate cross-project skips, including desktop, phone, reviewed widths, the exact 901/900 boundary, forced colors, print, Axe, and horizontal overflow. |
| Pinned merged-main intermediate follow-up | CI exposed the same upstream-geometry rerasterization at 820 px after the first stale Steps screenshot stopped the later Cooking breakdown capture. A pinned pre-update double-run reported 5,163 changed pixels twice with byte-identical Steps actuals. The staged update produced exactly the intermediate Steps and Cooking breakdown references; both were inspected at original resolution and retained the same content and layout with only vertical viewport reframing. The focused post-update repeat passed twice with two deliberate project skips. The first complete double-run then exposed one sequence-sensitive forced-colors assertion that was scoped to the visible comparison hero; its focused repeat passed twice, and the final exact CI command passed 190 checks with 178 deliberate project skips. |
| Stateful release assertion compatibility | The comparison assertions in the guarded release journey were migrated to the inline-diff contract and passed lint and TypeScript checks; the full release operator remains owned by its isolated OIDC/database workflow. |
| Opaque-source policy | The audit matched all 98 tracked PNGs to reviewed object IDs with zero drift; 54 source-package tests and 34 parameterized subtests passed. The title-and-description and merged-main follow-ups bind the new desktop-top PNG and all seven refreshed comparison PNGs to their reviewed object IDs. |
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
