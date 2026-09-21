# Frontend

This document explains how the frontend is structured and the conventions used when adding or changing frontend code. For the system-level request paths and backend boundaries, see [Architecture](architecture.md). For test tiers and verification commands, see [Testing](testing.md).

## Project structure

```text
frontend/
├── app/          Next.js routes and cross-feature composition
├── features/     Product behavior, state, API adapters, and UI
├── shared/       Domain-neutral UI, navigation, and API mechanics
├── shell/        Site-wide framing such as the header and footer
├── server/       Same-origin proxy and standalone server code
├── tests/        Cross-cutting frontend test support
├── e2e/          Browser workflows
├── baselines/    Reviewed visual baselines
├── scripts/      Frontend verification and maintenance tools
└── public/       Static assets
```

## `app`: routes and composition

`frontend/app` owns the Next.js application entry points:

- pages and layouts;
- loading, error, and not-found states;
- route parameters and search parameters;
- redirects;
- composition that crosses feature boundaries.

This is the right place to combine independent features without making them depend directly on one another.

For example, a recipe page may need public recipe data, member actions, reporting controls, follow controls, and an inline authoring experience. Those concerns can meet at the route level while continuing to belong to their own features.

## `features`: product behavior

Most frontend code lives under `frontend/features`.

Major feature areas include:

```text
features/
├── account/
├── auth/
├── community/
├── ingredients/
├── moderation/
└── recipes/
    ├── authoring/
    ├── browse/
    ├── detail/
    ├── library/
    └── shared/
```

A feature normally owns:

- its user interface;
- its local state and hooks;
- browser or server API adapters specific to that domain;
- runtime parsing of domain responses;
- domain-specific error handling;
- colocated tests.

The recipe feature is split into workflows because browsing, reading, authoring, and managing a private library have different responsibilities. Concepts used by more than one recipe workflow can live in `features/recipes/shared`.

Global `shared` is reserved for code that does not need to know what a recipe, ingredient request, member account, or moderation case is.

## `shared`: application-neutral building blocks

`frontend/shared` contains reusable mechanics that are not owned by a product domain.

Examples include:

- browser and server transport helpers;
- generated API types;
- CSRF and session-expiration signaling;
- navigation blocking;
- loading states;
- overlay and focus primitives;
- workspace pagination and other generic UI structure.

Shared code should stay small and predictable. It should not become a place to hide cross-feature dependencies.

If a helper needs recipe terminology, account-specific policy, or moderation state to make sense, it probably does not belong here.

## `shell`: site-wide framing

`frontend/shell` owns the feature-neutral parts of the site frame, including the header and footer.

The shell can receive product-aware content through props or slots, but it does not import authentication, recipe, or community workflows directly.

For example, the header can render member controls supplied by the application composition layer without becoming responsible for authentication itself.

This keeps site framing reusable without turning it into another application-state owner.

## `server`: frontend server boundaries

`frontend/server` contains code that belongs to the server/runtime side of the frontend, including the hardened same-origin API proxy and standalone production server support.

Browser feature code should not import from this area.

The Next.js API route provides the framework bridge into the proxy, while public Server Components use the server API transport directly. The reasons for the two paths are covered in [Architecture](architecture.md).

## Server Components and Client Components

Recipe Lab uses Server Components for public data where that keeps the page simpler and avoids unnecessary client-side loading.

Typical public flow:

```text
Next.js page
  -> server API adapter
  -> FastAPI
  -> rendered public content
```

Client Components are used when the browser needs to own interaction or member-specific state, such as:

- authenticated member actions;
- private drafts;
- forms and dialogs;
- ratings and saves;
- follows;
- staff workspaces;
- session recovery.

The goal is not to maximize either Server Components or Client Components. The boundary should follow the behavior that actually needs to run in the browser.

Public server-side requests do not forward browser authentication. Member-specific requests go through the same-origin `/api` path instead.

## State ownership

Frontend state should have one clear owner.

A useful rule is:

> Keep state where the user or system action that changes it is understood.

Some common cases:

### URL state

If a selection should survive refresh, sharing, and Back/Forward navigation, the URL should usually own it.

Examples include public recipe search and the selected view/page in the member recipe workspace.

The feature can load data for that location, but it should not create a second independent page or filter state that disagrees with the route.

### Server-owned facts

If the backend is authoritative for a fact, the frontend should normally render the latest server result rather than create a second policy store for it.

Examples include:

- whether a recipe is saved;
- the current rating;
- recipe visibility;
- staff authorization;
- the current persisted draft revision.

Temporary UI feedback is fine, but confirmed state still comes from the server.

### Editable form state

Forms and editors need local state because the user may have unsaved work that intentionally differs from the server.

The draft editor therefore distinguishes the last confirmed server state from the current local document. The same principle applies to ordinary form edit buffers.

### Derived presentation state

Prefer deriving display values from existing state instead of keeping a second synchronized copy.

A second copy is justified only when it represents a genuinely different concept, such as an unsaved edit buffer or an in-progress recovery state.

## Async operations and stale results

An asynchronous operation belongs to the resource that started it.

If the user changes pages, selects a different moderation case, opens another draft, or changes the query while a request is in flight, an older response must not be applied blindly to the new context.

Depending on the workflow, the frontend may:

- cancel the older request;
- ignore it using a request/generation identifier;
- apply it only if the current resource still matches;
- refresh the current location instead of applying stale local arithmetic.

This is especially important for mutations. A successful request for recipe A should not update whichever recipe happens to be on screen when it completes.

Idempotency keys and retry identities are part of the request contract where the backend supports replay. They should not be regenerated merely because the result of the first request was uncertain.

## Authentication and protected UI

Frontend authentication state exists to support navigation and presentation. It is not the authorization boundary.

The UI may:

- show a sign-in prompt;
- hide unavailable controls;
- preserve an editor while a session is being recovered;
- redirect a member through onboarding;
- display staff tools based on current session capabilities.

The backend still decides whether the request is authorized.

Session recovery is intentionally separate from a normal session refresh. If a session expires while a member has unsaved work, Recipe Lab can preserve that browser state while the member signs in again. Recovery only resumes the interrupted work when the same account returns.

For the security model behind this behavior, see [Security](security.md).

## Navigation patterns

Controls that look visually similar can have different semantics.

### URL-backed navigation

Use links when the destination has a meaningful URL and should work with refresh, sharing, and browser history.

Examples include recipe-library views and other route-level destinations.

### Filters

Use buttons or form controls when the user is filtering data on the current screen rather than navigating to another page.

The feature owns the query, debounce behavior, loading state, and pagination reset that go with that filter.

### In-page tabs

Use tab semantics when the controls switch panels within the same page.

Keyboard behavior should support the expected Arrow Left, Arrow Right, Home, and End navigation. Features still own their actual content and route/hash behavior.

The semantic choice comes before the styling choice.

## Forms and unsaved work

Forms should preserve the user's entered values when validation or network requests fail.

Backend validation errors are mapped to the field or structured item they refer to. A form may also provide a summary so keyboard and screen-reader users can move to the first problem efficiently.

Focus should move only when there is a clear reason, such as:

- opening a dialog;
- activating a keyboard-controlled tab;
- focusing an error summary after a failed submission.

Background loading or an unrelated asynchronous completion should not steal focus.

Recipe authoring also uses navigation blocking when the current document differs from the last confirmed server state. A successful save, discard, or publication can clear that protection; a failed request cannot.

## Accessibility

Accessibility behavior is part of the component contract, not an afterthought layered on top of it.

Shared primitives own generic mechanics such as:

- focus trapping;
- Escape behavior;
- outside interaction;
- focus restoration;
- body scroll locking.

Feature components own domain-specific interaction, including:

- ingredient-combobox keyboard behavior;
- recipe tab selection;
- validation focus;
- publication dialogs;
- rating controls;
- session-recovery focus.

Responsive layouts must preserve usable focus states, source order, accessible names, and keyboard access. Reordering ingredients, instructions, or cooking actions cannot depend on drag-and-drop alone.

## Styling

`frontend/app/globals.css` is the stylesheet manifest. Styles are grouped by responsibility:

```text
tokens
  -> base
  -> shell
  -> primitives
  -> features
  -> patterns
```

The stylesheet owner should match the component owner.

- shell header/footer styles belong with shell styling;
- shared workspace primitives own their base styles;
- recipe-specific states belong in recipe feature styles;
- contextual overrides should be scoped to the context that needs them.

Avoid globally styling a shell or shared selector from an unrelated feature stylesheet. That creates dependencies that are invisible in the TypeScript import graph.

Moving a declaration between layers can change the cascade even when the declaration text is identical, so CSS ownership changes should be checked visually at the relevant responsive sizes.

## Product language

The frontend should describe the product in language that makes sense to a cook, not in database terminology.

| Concept                                        | Prefer                       | Avoid in ordinary UI     |
| ---------------------------------------------- | ---------------------------- | ------------------------ |
| A published state of a recipe                  | Version                      | Edition record, snapshot |
| A recipe based on another recipe               | Your version, based on       | Fork, child, variant     |
| The recipe that was used as the starting point | Based on, source version     | Parent snapshot          |
| Connected recipe history                       | Recipe history               | Lineage, topology        |
| Private editable work                          | Draft                        | Working snapshot         |
| Publishing a change to the same recipe         | Publish changes, new version | Advance current          |
| Duplicate review                               | Similar recipes              | Fingerprint match        |

Internal technical terms are fine in code and engineering documentation when they describe a real implementation distinction. They should not leak into ordinary screens just because they exist in the database model.

The recommendation code follows the same rule. The current application should not imply that it provides production personalization when the corresponding models are still part of the offline research/evaluation workspace.

## Frontend architecture checks

The repository includes automated checks for the boundaries described here. They cover things such as:

- retired source locations;
- dependency direction;
- reviewed cross-feature imports;
- broad barrel files;
- runtime dependency cycles;
- client code reaching server-only modules;
- stylesheet ownership and layer rules;
- production module reachability.

These checks are guardrails, not a replacement for behavior tests. A dependency graph can be valid while a stale async result, focus bug, or visual regression is still wrong.

See [Testing](testing.md) for the frontend unit, browser, accessibility, and visual test strategy.

## When adding frontend code

Before introducing a new module or abstraction, ask:

1. **Who owns the concept?** Put it with that feature or route composition layer.
2. **Is this actually domain-neutral?** If not, it does not belong in global `shared`.
3. **Does this state already have an authority?** Avoid creating a mirrored copy unless it represents a different lifecycle.
4. **What resource owns this async result?** Make stale completion behavior explicit.
5. **Is this a real second use case?** Do not add modes, variants, or callbacks for hypothetical reuse.
6. **Does the abstraction remove a concept?** A new wrapper that only renames an existing component is usually not useful.
7. **Does the UI language describe the product or the storage model?** Prefer the product.

The frontend should remain easy to follow from the route down: composition in `app`, product behavior in `features`, reusable mechanics in `shared`, and server-only concerns kept on the server side of the boundary.
