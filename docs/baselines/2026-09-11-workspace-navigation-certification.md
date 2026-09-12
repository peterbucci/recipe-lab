# RCP-51 workspace navigation certification

Date: 2026-09-11

This record describes the RCP-51 review candidate assembled on
`codex/rcp-51-workspace-navigation-integration`. Each implementation pass is
also preserved on the topic branch listed below. `main` remains unchanged
pending review.

## Story map

| Story | Topic branch | Candidate scope |
| --- | --- | --- |
| RCP-51A | `codex/rcp-51a-workspace-panel-shell` | Centralize the shared workspace frame without absorbing feature-owned layout. |
| RCP-51B | `codex/rcp-51b-workspace-control-semantics` | Align links, pressed filters, and tabs with the behavior each control actually owns. |
| RCP-51C | `codex/rcp-51c-workspace-query-parsing` | Share bounded query parsing while preserving canonical, feature-owned URLs. |
| RCP-51D | `codex/rcp-51d-accessible-roving-tabs` | Share keyboard and focus mechanics across true in-page tabsets. |
| RCP-51E | `codex/rcp-51e-cleanup-certification` | Remove superseded feature chrome, document the ownership rules, and certify the responsive and accessibility contract. |

The durable ownership and extension rules are recorded in
[Frontend workspace navigation](../frontend-workspace-navigation.md). That
document is the maintained semantic and primitive contract; this dated record
captures only the candidate's review evidence and verification results.

## Reviewed workspace evidence

The checked-in desktop and phone state matrices already cover all six RCP-51
workspace surfaces. Settings, Staff Tools, and Connections record both of their
selectable views. The intermediate matrix also records Activity, My Recipes,
member Ingredient Requests, Settings, and Staff Tools at 820 CSS pixels.
`captureBaseline` runs the WCAG 2.0/2.1 A/AA Axe rules and a horizontal-overflow
assertion before every screenshot.

| Surface | Existing checked-in references | Assertion at 680 CSS pixels |
| --- | --- | --- |
| Activity | Desktop, 820 px, and phone normal states | Filter group remains pressed, search stacks, and the frame bleeds at the 700 px boundary. |
| My Recipes | Desktop, 820 px, and phone normal states | Drafts remains the URL-owned current view and the frame bleeds. |
| Connections | Desktop and phone Followers and Following states | Both URLs, lists, and current-link states work inside the bleeding frame. |
| Ingredient Requests | Desktop, 820 px, and phone normal states | Filters and search stack, while the frame intentionally remains inset until 650 px. |
| Settings | Desktop, 820 px, and phone Profile and Danger zone states | Both tab panels remain operable inside the bleeding frame. |
| Staff Tools | Desktop, 820 px, and phone Curator and Moderator states | Both capability panels remain operable inside the bleeding frame. |

The additional 680 px journey in
`frontend/e2e/visual/intermediate-states-baseline.spec.ts` is assertion-only.
It reruns Axe and overflow checks after every surface and after both selectable
views where applicable, but deliberately adds no screenshot tier. The 87
approved PNGs already present on this branch remain the complete visual set.

## Responsive exception

The shared opt-in changes ordinary workspace shells to edge-to-edge presentation
at 700 px. Member Ingredient Requests intentionally retains its inset border and
radius at 680 px and bleeds only at its existing 650 px feature boundary. The
certification asserts that exception so later shared-shell work cannot silently
move it.

## Recorded verification

| Check | Result |
| --- | --- |
| Browser-mode discovery | Smoke 17, acceptance 23, performance 1, release 1, visual 178 (89 logical checks across two projects). |
| Focused 680 px visual/accessibility journey | 1 applicable desktop check passed; 1 deliberate phone-project duplicate skipped. |
| Focused Story E unit and component suite | 11 files, 75 tests passed; the post-fix CSS contract rerun also passed 10 of 10 tests. |
| Lint and generated-route TypeScript checks | ESLint and generated-route TypeScript checks passed. |
| Frontend architecture and reachability | Both audits passed. |
| Locked repository contracts | Repository policy, architecture, documentation links, OpenAPI snapshot, seed data, generated API contracts, and CSS architecture passed. |
| Production build | Next.js production build and its TypeScript phase passed; 20 static pages generated. |
| Full frontend unit and component suite | 181 files, 996 tests passed. |
| Pull-request browser smoke | 17 Chromium and engine-sanity checks passed. |
| Pinned visual/accessibility double-run | The committed screenshots are Linux-authored, so the full pixel comparison is delegated to hosted Linux CI. The cross-platform 680 px assertion and WCAG journey passed locally. |
| Diff hygiene | `git diff --check` passed. |

The focused browser command is:

```text
cd frontend
npm run build
node scripts/run-playwright-mode.mjs visual --grep "workspace navigation survives the 680 px breakpoint"
```

The full double-run remains the final regression authority because the 680 px
journey supplements rather than replaces the reviewed desktop, 820 px, and
phone screenshots.

## Review boundary

Review the completed candidate as
`main...codex/rcp-51-workspace-navigation-integration`. Do not merge it to
`main` until its hosted checks have passed and the changes have been reviewed.
