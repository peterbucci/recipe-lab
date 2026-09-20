# Frontend

Recipe Lab's frontend is organized by ownership, not by whether a module is a
component, hook, or helper. The goal is to keep domain behavior with the
workflow that understands it, keep application composition explicit, and make
browser/server trust boundaries visible in the source tree.

This guide describes the maintained structure and interaction rules. Runtime
topology is summarized in [Architecture](architecture.md), and test execution
belongs in [Testing](testing.md).

## Ownership and dependency direction

```text
frontend/
├── app/          Next.js routes and route-private composition
├── features/     Domain UI, state, API adapters, parsing, and colocated tests
├── shared/       Domain-neutral UI, navigation, and API infrastructure
├── shell/        Feature-neutral header, footer, and site frame
├── server/       Same-origin proxy and standalone Node modules
├── tests/        Cross-cutting contracts and test support
├── e2e/          Browser workflows grouped by execution purpose
├── baselines/    Reviewed visual expectations
├── scripts/      Frontend verification and maintenance tools
└── public/       Static assets
```

The intended runtime direction is:

```text
app --------> shell ------> shared
 |                            ^
 +----------> features -------+

server ---------------------> shared
```

### `app`: composition boundary

`app` owns Next.js `page`, `layout`, `loading`, `error`, `not-found`, and
`route` entry points. It may own route-private composition in an
underscore-prefixed folder when a page needs to join several features.

This is the normal place to combine account access, a recipe workflow, and
shell controls. Moving that composition into either feature would create the
wrong ownership or a cycle. Reusable domain behavior does not live in `app`.

### `features`: domain owners

Each feature owns its user interface, state, API operations, domain parsing,
hooks, and colocated tests. Recipe workflows are separated into browse,
detail, library, authoring, and recipe-shared modules. Ingredient catalog,
request, and review workflows remain ingredient-owned; account, authentication,
community, and moderation have their own boundaries.

Code shared by peer recipe workflows belongs in `features/recipes/shared`, not
in global `shared`. Cross-feature imports are allowed only through narrow,
reviewed modules. If two larger workflows need to cooperate, `app` composes
them instead of making them depend on each other.

### `shared`: domain-neutral mechanics

`shared/ui` contains primitives whose meaning does not depend on recipes,
accounts, moderation, or ingredients. `shared/navigation` contains generic
navigation and unload-blocking mechanics. `shared/api` contains generated wire
types, transport behavior, and low-level session and CSRF signaling.

Reuse alone is not enough to move a module here. Recipe cards, recipe artwork,
ingredient controls, staff gates, and recipe-aware pagination remain with the
domain that defines them. Shared code imports only shared code.

### `shell` and `server`

`shell` owns the presentational site header, footer, and outer frame. It accepts
feature-aware controls through explicit slots; it never imports feature
workflows or domain parsers.

`server` owns the streaming same-origin proxy and code used by the standalone
Node runtime. Browser modules cannot reach it directly or transitively. The
Next.js API route is the reviewed bridge into the proxy. Server-only modules
remain marked and code imported by root `server.mjs` stays usable without the
Next.js compiler.

The retired `app/components` and `lib` source locations must stay empty. Broad
feature-root and shared-root barrel files are also avoided because they hide
dependency direction and can accidentally join client and server graphs.

## Data access and state ownership

Public route loaders run on the server and call FastAPI through the internal
API origin. They cannot send browser cookies or CSRF headers. Browser features
call only relative `/api/...` paths through the same-origin proxy. Protected
mutations carry the application session, CSRF evidence, and an idempotency key
where the backend defines replay semantics.

Transport mechanics are shared, but domain interpretation is not. A feature
owns its runtime response parser, public error wording, and the state that
drives its UI. Generated OpenAPI types document represented wire shapes; they
do not make requests or authorize actions.

New state should have one authority:

- keep URL-backed selection in the URL;
- keep server-owned facts in the server response rather than mirroring them in
  a second policy store;
- keep editable form values in the owning editor state; and
- derive presentation values instead of synchronizing duplicate copies.

An asynchronous operation is bound to the resource and intent that started it.
Changing pages, recipe versions, draft kinds, or source versions must cancel,
ignore, or separately scope an older completion. A late result must never act
on whichever resource happens to be rendered when it arrives. Draft-creation
recovery, for example, keys an attempt by actor and exact intent and reuses the
same idempotency identity after an uncertain outcome.

UI authorization is only presentation. The frontend may hide an unavailable
control or route a signed-out member toward sign-in, but the backend session
and policy checks remain authoritative.

## Page and section states

State presentation is selected along independent axes:

| Question | Choices | Rule |
| --- | --- | --- |
| What happened? | Missing, load failure, sign-in required, setup required, denied, empty, out of range | State only what is known; do not guess at a cause. |
| What is affected? | Route, section, inline control | Preserve usable page content when only one section failed. |
| Is existence safe to reveal? | Explicit or concealed | Protected resources may use the same neutral unavailable state as a missing resource. |
| What can recover? | Retry, navigate, next action, none | Offer only a recovery the caller can actually perform. |
| Should it be announced? | Alert or ordinary content | Announce a request failure; ordinary missing, empty, auth, and pagination states are not automatically alerts. |

`StatePage` and `StatePanel` own blocking-route structure without knowing why a
route is blocked. `WorkspaceErrorState` owns section-scoped failures, while
`WorkspaceEmptyState` owns ordinary empty or terminal content. Inline form and
control feedback remains feature-owned. Route and feature code supplies all
domain copy and safe destinations.

Errors never render raw exception text or private server details. Concealed
staff routes may deliberately use generic unavailable copy, while the
protected API still performs the real role check.

## Navigation semantics

Controls that look like tabs do not necessarily share behavior. Choose the
semantic model before the visual primitive.

### URL-backed views

Use links when a view has a canonical address and should survive refresh,
sharing, and Back/Forward navigation. The active destination uses
`aria-current="page"`. My Recipes and Connections use this model. Parsing and
canonical URLs remain route-owned.

### Dataset filters

Use a labelled button group when selection filters data already shown on the
page. Buttons expose `aria-pressed`. Activity and ingredient-request filters
use this model. The feature owns requests, debounce, pagination, loading, and
filter reset behavior.

### In-page panels

Use `tablist`, `tab`, and `tabpanel` when controls switch panels within one
page. Exactly one enabled tab is in the tab order. Arrow Left, Arrow Right,
Home, and End activate and focus the destination; a pointer click does not
force an additional focus move. Shared roving-tab mechanics own that keyboard
contract, while each feature owns IDs, content, hashes, and side effects.

Recipe instruction tabs, comparison tabs, settings, and staff tools reuse
appropriate presentation without pretending they share one domain state. A
validation error may reveal the panel containing the field, but it must not
destroy the user's chosen view or make unrelated panels unreachable.

## Forms, focus, and navigation blocking

Editors preserve raw entered values across validation and request failures.
Backend field issues are mapped to the field or structured item that initiated
them; a top-level summary provides the accessible announcement and focus
target. Validation may highlight a field without duplicating long error prose
under every control.

Focus moves only for a reason the user can understand: opening a dialog,
activating a keyboard tab, or focusing the first actionable error after a
failed submission. Re-rendering, polling, or an asynchronous success elsewhere
must not steal focus.

Unsaved-change protection compares the current editor with the last confirmed
server save. It covers reload, close, browser history, and client-side links.
A failed save does not clear the warning; a confirmed save, discard, or
successful publication does. The generic blocker lives in shared navigation,
while the recipe authoring feature decides whether its document is dirty.

Publish may save a dirty draft without requiring a separate manual Save. The
completion remains bound to the initiating draft, revision, and intent; review
opens only if those still match what is rendered. Conflicts and edits made
during the request preserve local values and keep review closed.

Ordering controls for ingredients, instructions, and cooking actions are
keyboard operable and are never drag-only. Responsive changes preserve source
order, accessible names, visible focus, minimum target usability, and the
absence of horizontal overflow.

## Styling ownership

`app/globals.css` is the stylesheet manifest. Its cascade order is stable:

```text
tokens -> base -> shell -> primitives -> features -> patterns
```

Every imported stylesheet owns one layer. Shared primitives are low-specificity
opt-in classes for declarations already common to multiple consumers. Shared
patterns are authoritative components: a feature may lay them out but may not
silently restyle their internal contract. Domain-specific layout and state
stay in the owning feature stylesheet.

A declaration moved between layers is a visual change even when its text is
unchanged. CSS ownership, responsive behavior, forced colors, focus, and
approved visual expectations are therefore reviewed together.

## Product language

Cook-facing copy describes the product, not its storage model:

| Meaning | Preferred wording | Internal wording to avoid on ordinary screens |
| --- | --- | --- |
| A recipe made from another recipe | Your version, version | Fork, child, variant |
| The exact recipe copied | Based on, starting recipe | Parent snapshot |
| Connected published versions | Recipe history | Lineage, topology |
| Mutable private work | Draft, save draft | Working snapshot, commit |
| Same-recipe publication | Publish changes, older version | Advance current, revision node |
| Structural publication review | Similar recipes | Fingerprint or duplicate-candidate match |

An author-declared correction or update is self-reported provenance, not proof
that a recipe was cooked, improved, or made safe. Ordinary screens also avoid
database UUIDs, canonical IDs, policy versions, and immutable-snapshot jargon
unless the identifier is necessary in a restricted staff or diagnostic
context.

Recipe Lab currently has no consumer recommendation experience. The API-only
baseline and offline models are labelled research or experimental; onboarding,
metadata, screenshots, and ordinary UI must not imply personalized suggestions
or that the application learns what worked for a member.

## Enforcement

Architecture checks inventory production source, reject retired locations,
unreviewed outward imports, broad barrels, runtime cycles, and client paths to
server-only modules. CSS checks protect layer ownership and pattern
specificity. Source reachability and language-policy checks cover their own
boundaries. Tests stay beside the production module they protect; cross-cutting
contracts stay under `tests`, and browser workflows stay under `e2e`.

These checks support the ownership model; they do not replace behavior,
keyboard, accessibility, responsive, and real-stack verification described in
[Testing](testing.md).
