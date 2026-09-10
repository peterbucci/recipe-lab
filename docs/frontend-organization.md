# Frontend ownership architecture

This document defines where frontend code belongs and which dependency
directions are allowed. RCP-49 completed this structure; these are the
long-term placement rules for every subsequent change.

The refactor changes ownership and file placement, not product behavior. Route
URLs, API requests and responses, member-visible language, stylesheet order,
test assertions, and approved visual baselines remain stable unless a separate
change explicitly reviews them.

## Target structure

```text
frontend/
├── app/                 Next.js routes and route-private composition
├── features/
│   ├── auth/
│   ├── account/
│   ├── recipes/
│   │   ├── browse/
│   │   ├── detail/
│   │   ├── library/
│   │   ├── authoring/
│   │   └── shared/
│   ├── ingredients/
│   │   ├── catalog/
│   │   ├── requests/
│   │   └── review/
│   ├── community/
│   └── moderation/
├── shared/              Domain-neutral UI, navigation, and API infrastructure
├── shell/               Domain-neutral header, footer, and site-wide framing
├── server/              Standalone and Next server boundaries
├── tests/               Cross-cutting contracts, configuration, and support
├── e2e/                 Browser suites grouped by execution purpose
├── baselines/           Approved visual baselines
├── scripts/             Frontend maintenance and verification tools
└── public/              Static public assets
```

Directories are created only when their first owned module moves. Small,
purposeful folders are acceptable; empty speculative folders are not. The app
does not gain a `src` wrapper merely to move the same hierarchy one level
deeper.

The existing `app/styles` stylesheet manifest and cascade order remain in
place. Any future move must be a separately reviewed mechanical change that
keeps `app/globals.css` import order and every CSS layer unchanged.

`app/components` and `lib` are retired source locations. New runtime, test,
or support modules in either directory fail the architecture check.

## Ownership rules

### `app`

`app` owns Next.js entry files such as `page`, `layout`, `loading`, `error`,
`not-found`, and `route`. A route may also own private composition in an
underscore-prefixed folder when that composition exists only to join multiple
features for that route. Reusable feature behavior does not live in `app`.

### `features`

A feature owns its UI, state, API operations, domain parsing, hooks, test
support, and colocated tests. Recipe code is divided by user workflow, while
recipe models and presentation used by multiple recipe workflows live in
`features/recipes/shared`.

Cross-feature imports must target the narrow owning module. Recipe authoring may
consume ingredient catalog contracts and recipe-shared code. Community may
consume recipe-shared public contracts. Route-private composition joins larger
features when placing that composition in either feature would create a cycle.

### `shared`

`shared/ui` and `shared/navigation` contain domain-neutral primitives.
`shared/api` contains generated wire contracts, transport, request mechanics,
and low-level browser session/CSRF signaling. Shared code never imports a
feature, the application shell, or a route.

Reusable does not automatically mean shared. Recipe cards, artwork, recipe
formatting, staff access gates, and recipe-aware pagination remain with their
domain owners.

### `shell`

`shell` owns the domain-neutral, presentational site header, footer, and
site-wide frame. Feature-aware controls and provider composition stay in
`app`, which supplies those controls to shell components through explicit
slots. Shell code does not import feature workflows or domain parsing.

### `server`

`server` owns the streaming proxy and the standalone Node runtime modules. Code
used by root `server.mjs` must remain importable by plain Node and must not gain
a Next-only marker. Browser modules must not directly or transitively reach a
server transport.

## Dependency direction

The intended direction is:

```text
app --------> shell ------> shared
 |                            ^
 +----------> features -------+
 +----------------------------+

server ---------------------> shared
```

`app` may import all inward layers and owns composition between the shell and
features. `shell` may import only shell and shared code. Features may import
shared code and explicitly reviewed narrow modules from another feature.
Shared code imports only shared code. Server code imports server or shared
code. The Next API route is the reviewed exception that may import the
streaming proxy from `server`.

| Importer | Allowed dependencies |
|---|---|
| `app` | `app`, `features`, `shared`, and `shell`; Next API route modules may also import `server` |
| `features` | `shared`, the same feature, and only reviewed cross-feature public modules |
| `shared` | `shared` |
| `shell` | `shell` and `shared` |
| `server` | `server` and `shared` |

Recipe workflows have an additional boundary. Browse, detail, library, and
authoring may consume `features/recipes/shared`. Other cross-workflow imports
are limited to the small existing integration seams named in the architecture
checker. Recipe shared code cannot import authoring, community cannot import
the private recipe library, and authoring cannot import private detail modules.

Use explicit module imports. Feature-root or shared-root barrel files are not
allowed because they hide dependency direction and can combine client and
server graphs. Preserve every existing `"use client"` boundary when moving a
module.

## Tests and verification

Tests move with the production module they protect. Cross-cutting contract and
configuration tests stay in `tests`; browser workflows stay in `e2e`. A move is
not permission to weaken, rewrite, or delete an assertion.

Every story updates all path consumers in the same change:

- runtime imports and test mocks;
- Vitest discovery, runtime ownership, coverage roots, and exclusions;
- ESLint production scopes and reviewed raw-fetch exceptions;
- source reachability and content-language scanning;
- generated-contract destinations and consumer evidence where applicable;
- route-theme evidence and current documentation links.

`npm run architecture:check` rejects any source in the retired
`app/components` or `lib` locations, outward or unreviewed cross-feature
imports, broad barrel files, runtime dependency cycles, and direct or indirect
client paths into a marked server module or the standalone `server` directory.
`npm run ci:verify` delegates to the repository-owned `frontend` suite in
`scripts/run_quality_gate.py`, which includes this audit. Type-only imports do
not enter the runtime graph, while Next's `server-only` compiler checks
complement this source audit; unit-test marker aliases are confined to Vitest
configuration.

## Story ownership map

| Story | Responsibility | Destination |
|---|---|---|
| RCP-49A | Ownership rules, baseline, and migration checks | Documentation and verification tooling |
| RCP-49B | Generic UI, navigation, and application shell | `shared/ui`, `shared/navigation`, `shell` |
| RCP-49C | Transport, generated contracts, CSRF/session mechanics | `shared/api` |
| RCP-49D | Recipe reports and staff moderation | `features/moderation` |
| RCP-49E | Ingredient catalog, member requests, and staff review | `features/ingredients` |
| RCP-49F | Recipe browse, detail, libraries, and common recipe code | `features/recipes/{browse,detail,library,shared}` |
| RCP-49G | Authentication, account, and community workflows | `features/{auth,account,community}` |
| RCP-49H | Draft editing, recovery, duplicate review, and publication | `features/recipes/authoring` |
| RCP-49I | Zero-legacy enforcement, final dependency certification, and execution evidence | Verification tooling and documentation |

RCP-49D keeps the `/staff` landing-page composition and reusable staff access
gate under `app`, because they coordinate multiple feature areas. Recipe
report submission and moderator review live under `features/moderation`;
their route wrapper composes the app-owned gate, while the domain-neutral
queue/detail workspace frame lives in `shared/ui`. The existing stylesheet
cascade remains in place, so this ownership move does not reorder visual rules.

RCP-49E keeps the member and curator route entry points under `app`, where
route-private wrappers compose the application-owned access gates with the
ingredient workspaces. Ingredient clients are separated by catalog search,
member requests, and curator review under `features/ingredients`; their common
model, parsers, and public error boundary remain feature-owned. The existing
stylesheet cascade and import order stay unchanged during this ownership move.

RCP-49F separates recipe catalog browsing, public detail and interaction,
private member libraries, and cross-workflow recipe contracts under
`features/recipes`. Public summary and cook-profile parsing live in
`features/recipes/shared`, so community and authoring consumers never depend on
private library models. The home dashboard, recipe-detail experience, and
account-access wrappers remain route-private under `app` because they compose
multiple workflows. Public cook-profile loading remains assigned to RCP-49G.
The existing stylesheet cascade and import order stay unchanged during this
ownership move.

RCP-49G owns authentication and session behavior in `features/auth`, member
settings and activity in `features/account`, and follows, community activity,
and public cook data in `features/community`. Home-dashboard and public-profile
composition remains route-private under `app`. The generic application shell
depends only on `shared` and `shell`; `app` composes feature-aware navigation
into that shell. The existing stylesheet cascade and import order remain
unchanged.

RCP-49H owns draft creation and recovery, editing state and validation,
structured cooking controls, duplicate preflight, and publication under
`features/recipes/authoring`. Draft, editor, duplicate, publication, and
authoring-shared modules are grouped by responsibility with their tests
colocated. Recipe structure contracts, catalog models, family navigation, and
instruction presentation shared with published recipe views live in
`features/recipes/shared`; route entry and multi-workflow detail/editor
composition remain under `app`. Navigation blocking stays domain-neutral in
`shared/navigation`, and the stylesheet cascade remains unchanged.

RCP-49I retires the transitional migration allowlists, certifies zero source
files under `app/components` and `lib`, and enforces runtime-cycle and
reviewed public-boundary rules. The completed topic branches are integrated in
`refactor/frontend-architecture`, which remains separate from `main` until
review.
