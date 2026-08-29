# Deterministic regression baselines

RCP-34B records the public visual, accessibility, and performance behavior that
must remain explainable while the frontend is refactored. It adds evidence; it
does not redesign a screen or make a performance result a product-quality
claim.

Three complementary lanes remain deliberately separate:

| Lane                                    | Data and runtime                                                                                   | What it proves                                                                                                                  | Retained evidence                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Sanitized visual/accessibility baseline | Invented, static fixture data in an immutable Playwright container                                 | Stable rendering, required states, responsive layouts, keyboard paths, and automated WCAG checks                                | A public aggregate JSON report for 7 days; sanitized actual/diff PNGs for 7 days only when the check fails |
| Public performance baseline             | Freshly migrated and seeded PostgreSQL 17, the backend, and a production Next.js build on loopback | Pre-refactor API latency/query counts, selected JavaScript sizes, and public-page responsiveness remain within reviewed budgets | The committed aggregate baseline; an ignored aggregate observation during a run                            |
| RCP-32 community acceptance             | Disposable accounts and a guarded local identity provider                                          | Real authentication, authorization, community state transitions, deletion, backup/restore, and privacy behavior                 | Only the existing identifier-free summaries; no private browser or service diagnostics                     |

The stable `RCP-32 community release gate` requires all three through its
existing MVP and RCP-32 prerequisites plus the separate
`RCP-34B deterministic baselines` check. None of the lanes may stand in for
another.

## Visual execution contract

The canonical visual runner is `frontend/playwright.baseline.config.ts`. CI
runs it in the official Playwright 1.62.1 Ubuntu 24.04 (Noble) image for
linux/amd64. The image reference is immutable:

```text
mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac
```

The source tag and digest were verified with:

```powershell
docker manifest inspect mcr.microsoft.com/playwright:v1.62.1-noble --verbose
```

The selected manifest reports `linux/amd64`. The container supplies the exact
browser binaries, Linux libraries, and font environment; `package-lock.json`
supplies `@playwright/test` 1.62.1. CI fails before comparison unless
Playwright reports 1.62.1 and bundled Chromium reports 151.0.7922.34. Updating
the image, digest, Playwright package, browser assertion, or expected PNGs is
one explicit baseline migration and must be reviewed together. See the
[official Playwright container contract](https://playwright.dev/docs/docker)
for the upstream image boundary.

The fixture fixes every input that would otherwise introduce pixel drift:

| Input                       | Canonical value                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Projects                    | `baseline-desktop-chromium`, `baseline-phone-chromium`                                        |
| Node.js                     | 22.23.2 in CI                                                                                 |
| Desktop viewport and screen | 1440 by 900 CSS pixels                                                                        |
| Phone viewport and screen   | 390 by 844 CSS pixels, mobile/touch enabled                                                   |
| Device pixel ratio          | 1                                                                                             |
| Locale and time zone        | `en-US`, UTC                                                                                  |
| Color and motion            | Light color scheme, `prefers-reduced-motion: reduce`                                          |
| Clock                       | `2026-08-27T12:00:00.000Z`                                                                    |
| Randomness                  | Seeded Web Crypto UUID sequence and fixed `Math.random`                                       |
| Identities                  | Reviewed UUID constants and the invented `Baseline Cook` / `baseline-cook` account            |
| Content                     | Reviewed synthetic recipe, draft, request, comparison, and moderation fixtures only           |
| Fonts                       | The Geist WOFF2 shipped with pinned Next.js 16.3.1, injected under deterministic test aliases |
| Network                     | New loopback-only servers for every run; service workers blocked                              |

The harness first asserts the production CSS font-family variables, then
installs the deterministic aliases and waits for `document.fonts.ready`. This
keeps font files stable without allowing the test override to hide a product
font-contract regression. Animations and transitions are disabled for capture.
The browser context starts empty and fixture dates, generated IDs, and account
state never come from the host clock or operating-system entropy. HTTP and
WebSocket route allowlists abort anything outside the two reviewed `127.0.0.1`
fixture/frontend ports, and a canary proves both paths fail closed. The test
fails on the aggregate blocked-network count without recording an attempted
destination.

CI invokes the suite with `--repeat-each=2` while the baseline is being
established. Both independent executions must compare successfully; retries do
not turn a mismatch into a pass. Changing the repeat count requires an explicit
stability review rather than a silent configuration edit.

## State and device matrix

Expected images are stored at
`frontend/baselines/{projectName}/{snapshotName}.png`. Desktop covers the wider
state matrix; phone covers the critical responsive surfaces. Every listed
image is produced from the same sanitized fixture contract.

| Surface or state                    | Desktop snapshot                      | Phone snapshot             |
| ----------------------------------- | ------------------------------------- | -------------------------- |
| Home, normal                        | `home-normal`                         | `home-normal`              |
| Home with account navigation open   | `home-account-navigation`             | `home-account-navigation`  |
| Catalog, normal                     | `catalog-normal`                      | `catalog-normal`           |
| Catalog, empty                      | `catalog-empty`                       | —                          |
| Recipe detail, normal               | `recipe-detail-normal`                | `recipe-detail-normal`     |
| Recipe comparison, normal           | `recipe-comparison-normal`            | `recipe-comparison-normal` |
| My Recipes, private drafts          | `my-recipes-normal`                   | `my-recipes-normal`        |
| Draft editor with validation        | `draft-editor-validation`             | `draft-editor-validation`  |
| Similarity and publication review   | `draft-similarity-publication-review` | —                          |
| Ingredient request and staff review | `ingredient-request-staff-review`     | —                          |
| Recipe moderation staff review      | `recipe-moderation-staff-review`      | —                          |
| Private workspace, loading          | `private-workspace-loading`           | —                          |
| Private workspace, failure          | `private-workspace-failure`           | —                          |
| Private workspace, expired session  | `private-workspace-expired-session`   | —                          |

Normal, loading, empty, failure, validation, review, publication, and
expired-session behavior are therefore represented where they apply without
making every combinatorial state a separate screenshot. The comparison,
similarity, ingredient-review, and moderation captures keep their distinct
explanations and controls visible; they are not reduced to generic status
cards.

Every captured stable state receives automated Axe checks for WCAG 2.0 A/AA
and 2.1 A/AA plus a root horizontal-overflow assertion. Across each project,
the account-navigation journey and draft-validation capture provide keyboard
coverage that:

1. opens account navigation with Enter;
2. tabs to My Recipes and activates it;
3. verifies the URL and focus destination;
4. verifies the private workspace destination; and
5. activates draft validation with Enter and verifies focus moves to the
   validation target.

Staff states receive the same Axe and overflow checks. These automated checks
are regression evidence, not a substitute for manual assistive-technology and
usability review.

## Sanitized fixture and artifact boundary

`frontend/e2e/rcp34b-baseline-fixture.mjs` serves only the reviewed synthetic
responses consumed by `frontend/e2e/rcp34b-baseline.spec.ts`. The suite must not
read an acceptance-session fixture, start the RCP-32 identity provider, connect
to PostgreSQL, reuse a signed-in browser profile, or contact an external host.
It contains no real name, handle, email, free-form report, recipe, cookie,
authorization value, CSRF token, OIDC value, or production identifier. Adding
a fixture field or request route requires privacy review before a golden is
accepted.

The baseline configuration disables automatic screenshots, traces, video, the
HTML reporter, and network logging. A screenshot assertion may create only its
expected, actual, and diff PNGs. Expected images stay in the reviewed source
tree. CI uploads only these exact paths:

```text
frontend/test-results/baseline/results.json
frontend/test-results/baseline/artifacts/**/*-actual.png
frontend/test-results/baseline/artifacts/**/*-diff.png
```

`results.json` is an allowlisted public aggregate with this shape:

```json
{
  "schema_version": 1,
  "suite": "rcp34b-deterministic-baselines",
  "status": "passed",
  "counts": { "total": 0, "passed": 0, "failed": 0, "skipped": 0 },
  "projects": [
    {
      "name": "baseline-desktop-chromium",
      "total": 0,
      "passed": 0,
      "failed": 0,
      "skipped": 0
    }
  ],
  "failures": []
}
```

Only the two fixed project names and sanitized test IDs may appear in failure
entries. The reporter excludes error text, standard output, request data,
cookies, headers, URLs, absolute paths, timestamps, and attachment metadata.
The aggregate is retained for 7 days on completed runs. Actual/diff PNGs are
uploaded only on failure and retained for 7 days. Missing artifacts are not
replaced by a broader directory upload. Playwright reports, traces, videos,
expected screenshots, service logs, network logs, and the whole
`test-results` directory are never uploaded by this job.

## Reviewing and updating screenshots

Run a normal comparison from `frontend` with:

```powershell
npm ci
npm run test:e2e:baseline
```

Local output is useful for diagnosis, but a golden is authoritative only when
generated with the immutable linux/amd64 image above. Use a clean disposable
checkout and the pinned container to reproduce CI. Inspect the expected,
actual, and diff image for every mismatch before deciding whether application
code or the expected image is wrong.

If the UI change is intentional:

1. confirm the fixture contains only reviewed invented data;
2. run `npm run test:e2e:baseline:update` in the pinned image;
3. review every changed PNG at its full resolution, including text, clipping,
   focus treatment, error copy, staff-only controls, and responsive overflow;
4. run `npm run test:e2e:baseline -- --repeat-each=2` in the same image;
5. run the focused accessibility and keyboard suite with the visual check;
6. bind each new or changed opaque PNG to its exact Git blob ID in the source
   export policy; and
7. run the source-packaging tests and the complete required checks.

`git hash-object -- <path>` prints the object ID used by the opaque-file policy.
Never update a PNG merely to make a flaky run green, mix browser/OS migrations
with an unrelated product change, accept a diff without opening it, or
allowlist generated actual/diff files. The source exporter fails closed on an
unreviewed or changed opaque object; see
[safe source packaging](source-packaging.md).

## Public performance protocol

The committed contract is
`docs/baselines/rcp-34b-public-performance.json`. It contains fixed public route
labels and aggregate observations only. It contains no account, session,
recipe, request, event, correlation, or database identifier and no
caller-controlled label.

The check runs inside the existing MVP acceptance job before its state-mutating
browser journey. That job uses an Ubuntu 24.04 x86-64 runner, exact Node
22.23.2 and Python 3.13.15 runtimes, and the linux/amd64 PostgreSQL 17.11 Alpine
image bound to its immutable manifest. It applies the complete migration
history and deterministic seed catalog, builds the production Next.js app, and
uses explicit loopback frontend/backend URLs. The workflow asserts the runtime
and database versions before measuring, while the performance spec asserts the
bundled Chromium version. The spec exercises public routes only; the acceptance
flags acknowledge the disposable database but do not authorize private-session
measurement.

The measurement protocol is:

- issue each selected public proxy request three times for warmup and 20 times
  for measurement, then record monotonic request-duration median and
  nearest-rank p95;
- count `SELECT` and `WITH` statements for two deterministic catalog page
  shapes and two identical seeded detail requests, require the catalog shapes
  to remain at three reads, require the detail reads to repeat deterministically,
  and enforce the reviewed ceilings in backend tests;
- inspect decoded production JavaScript bytes loaded by the selected public
  pages rather than reading source or development bundles;
- warm each selected browser route once, then perform seven measured Chromium
  desktop navigations in one anonymous context;
- record median navigation, largest-contentful-paint, cumulative-layout-shift,
  total long-task, responsiveness, and decoded-JavaScript observations without
  synthetic CPU or network throttling;
- calculate each navigation's responsiveness as nearest-rank p95 across eight
  animation-frame yields; and
- compare every value with its committed per-metric budget.

The fixed route inventory is:

| Kind     | Route labels                                                   | Baseline metrics                                                                                                              |
| -------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Database | `public_recipe_catalog_read`, `public_recipe_detail_read`      | Exact repeated SELECT/WITH count: catalog 3 with ceiling 3; detail 8 with ceiling 10                                          |
| Service  | `public_recipe_catalog_proxy`, `public_recipe_detail_proxy`    | Latency median and p95, milliseconds                                                                                          |
| Browser  | `public_home`, `public_recipe_catalog`, `public_recipe_detail` | Navigation median, LCP median, CLS median, long-task-total median, responsiveness median, and decoded-JavaScript median bytes |

The initial measured values and budgets are below. Each cell is
`baseline → budget`; timing values are milliseconds.

| Service route       | Latency median |  Latency p95 |
| ------------------- | -------------: | -----------: |
| Catalog proxy       |   17.3 → 267.3 | 19.9 → 269.9 |
| Recipe-detail proxy |   28.3 → 278.3 | 32.1 → 282.1 |

| Browser route |   Navigation |       LCP |      CLS | Long-task total | Responsiveness |  Decoded JS bytes |
| ------------- | -----------: | --------: | -------: | --------------: | -------------: | ----------------: |
| Home          | 15.5 → 265.5 |  28 → 278 | 0 → 0.05 |         0 → 250 |   17.7 → 267.7 | 471,126 → 942,252 |
| Catalog       | 23.4 → 273.4 |  48 → 298 | 0 → 0.05 |         0 → 250 |   17.7 → 267.7 | 471,126 → 942,252 |
| Recipe detail | 47.6 → 297.6 | 324 → 648 | 0 → 0.05 |         0 → 250 |   17.6 → 267.6 | 488,167 → 976,334 |

Baseline and budget values live together in the committed JSON. For measured
latency/browser values, each budget is
`max(baseline × 2, baseline + absolute headroom)`, rounded upward at the
metric's precision. Absolute headroom is 250 ms for timing metrics, 0.05 for
CLS, and 131,072 bytes for decoded JavaScript. Database ceilings are fixed
reviewed integers rather than noisy browser observations or values derived from
that formula. A missing route, metric, query observation, bundle, sample, or
budget is a failure; a faster measurement does not rewrite the baseline.

With the isolated stack already running, the required check is:

```powershell
cd frontend
$env:RCP34B_PERFORMANCE = "1"
$env:RCP34B_PERFORMANCE_MODE = "check"
npx playwright test e2e/public-performance-baseline.spec.ts --project=chromium
```

Setting `RCP34B_PERFORMANCE=1` without both isolated-MVP guard variables is a
hard failure, not a skipped success. Ordinary browser runs omit that explicit
request and continue to skip this real-stack-only test.

It writes the ignored public observation to
`frontend/test-results/rcp-34b-public-performance-observation.json`. To measure
an explicit candidate before an intentional rebaseline, change the mode to
`capture`; the suite writes
`frontend/test-results/rcp-34b-public-performance-baseline-candidate.json` and
does not enforce or overwrite the committed observed values. Review the
candidate, the measurement environment, and the reason for every budget change
before manually updating the committed JSON. Then rerun `check` on the fresh
stack. CI never auto-promotes a candidate.

The numbers establish an engineering regression boundary on one synthetic,
loopback environment. They do not predict production tail latency, capacity,
real-device performance, accessibility quality, or user outcomes.

## Relationship to RCP-32

RCP-34B deliberately does not reuse RCP-32 browser state. The sanitized visual
fixture can safely retain reviewed screenshots because it has no secret or
account material. RCP-32 must exercise real opaque sessions and private state,
so its existing stricter rule remains unchanged: traces, screenshots, videos,
browser reports, service logs, manifests, and database dumps are destroyed;
only its three identifier-free summaries may be retained after the privacy
scan succeeds.

The community aggregate fails if the visual/accessibility job fails or if the
MVP job's public performance check fails. It also continues to require backend
quality, frontend quality, the full MVP journey, production images, the
dedicated RCP-32 acceptance, and safe source packaging. This adds gates without
removing, skipping, or weakening any RCP-32 or source-safety evidence.
