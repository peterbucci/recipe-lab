# Frontend state presentation

Recipe Lab describes route and section states along independent axes. A state is
not selected from a global message registry or a universal list of variants.
The owning route or feature supplies its copy and actions, while shared
primitives provide consistent structure and interaction mechanics.

## Decision table

| Axis | Choices | Decision |
| --- | --- | --- |
| Reason | Missing, load failure, authentication required, account-check failure, account setup required, no permission, out of range | State what happened without guessing at a cause. Missing resources and concealed permission failures may intentionally share copy when disclosure would reveal access or ownership. |
| Scope | Route, section, inline | A blocking route state uses `StatePage` and `StatePanel`. A failed section uses `WorkspaceErrorState`; an ordinary empty section uses `WorkspaceEmptyState`. Small field or control feedback remains domain-owned and inline. |
| Disclosure | Explicit, concealed | Be explicit when the information is safe and useful. Use the generic not-found presentation when confirming that a protected resource or capability exists would disclose private information. |
| Recovery | Retry, navigate, none | Offer retry only when the operation can reasonably succeed on another attempt. Otherwise provide a valid destination or the next required action. |
| Announcement | Alert, ordinary | Use an alert for a request or service failure that appears after an attempted operation. Authentication, setup, missing-resource, permission, empty, and out-of-range states are ordinary page content unless their actual interaction requires an announcement. |

A partial failure is a load failure whose scope is a section or inline region. It
must not replace an otherwise usable route with a full-page error state.

Direct staff workspaces use a concealed presentation when the current account
lacks the required capability. It deliberately shares generic not-found copy,
but authorization is client-gated, so the route document remains HTTP 200
rather than becoming a server 404. Protected staff APIs remain the authorization
boundary and reject cross-role reads with a generic 403 and no private payload.
The top-level `/staff` page remains explicit: an authenticated account with no
staff role is told that no staff tools are assigned.

## Primitive ownership

- `StatePage` and `StatePanel` own the accessible structure of blocking route
  states. They are server-compatible and know nothing about domains, reasons,
  permissions, or messages.
- `app/styles/primitives.css` owns the base `.state-page*` and `.state-panel*`
  selector families, including the `state-panel--wide` and
  `state-panel--large` size modifiers. Feature styles may contextualize a
  shared panel but must not recreate those families; the CSS architecture
  check enforces that boundary. Composing `StatePanel` with `.auth-card` is an
  intentional exception that retains the authentication surface.
- `RetryableStatePage` is the small client boundary for a blocking failure. It
  owns the retry button mechanics and composes the server-compatible route
  primitives. It does not receive or render raw errors.
- `WorkspaceErrorState` presents section-scoped request failures.
- `WorkspaceEmptyState` presents ordinary empty or terminal section content. It
  must not represent a retryable request failure.
- `PaginationOutOfRange` composes `WorkspaceEmptyState` for a collection page
  that no longer exists. The caller owns the collection-specific copy and the
  valid page-one destination or action.
- `WorkspacePagination` owns bounded pagination controls. Hide those controls
  while `PaginationOutOfRange` is shown; an out-of-range state is not a request
  failure and must not be styled or announced as one.
- Inline validation and control feedback remain with the feature that owns the
  interaction.

## Copy rules

Copy follows the domain rather than the primitive:

- Headings say what failed or what state the requested resource is in.
- Descriptions explain the useful next step without guessing why a request
  failed.
- Actions implement only recovery paths that the caller can support.
- Reserve “unavailable” for resources or content. Authentication and
  out-of-range states should say what the user needs to do or which collection
  page was requested instead of using “Page unavailable.”

## Testing contract

- Primitive tests own heading linkage, alert opt-in, action structure, and the
  shared class hooks.
- Route and feature tests own meaningful behavior: retry callbacks, safe exit
  destinations, sign-in return locations, disclosure boundaries, valid
  pagination destinations, and the absence of raw error details. They do not
  snapshot a shared primitive's class tree.
- Browser tests own the client-gated staff document HTTP 200 and protected API
  403 split.
- Visual baselines cover representative semantic states rather than duplicating
  every route-specific instance of the same presentation.
