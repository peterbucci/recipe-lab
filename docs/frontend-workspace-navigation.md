# Frontend workspace navigation

Recipe Lab workspace menus share presentation primitives, but they do not all
represent the same interaction. Choose the semantic model first and then reuse
only the structure or mechanics that model needs.

## Semantic models

### URL-backed views

Use links when a selection has a canonical URL and should survive refresh,
sharing, and browser navigation. The active link uses `aria-current="page"`.
My Recipes and Connections use this model. Query parsing and canonical hrefs
belong to their route contracts; the shared UI does not own navigation or
authentication guards.

### Dataset filters

Use a labelled button group when a selection filters the data already shown on
the page. Each button exposes `aria-pressed`. Activity and member or curator
ingredient-request filters use this model. Fetching, debounce, pagination,
loading, and reset behavior remain feature-owned.

### In-page panels

Use `tablist`, `tab`, and `tabpanel` when a selection changes panels inside one
page. Exactly one enabled tab is in the tab order. Arrow Left, Arrow Right,
Home, and End activate and focus the destination tab; pointer activation does
not programmatically move focus. `useRovingTabs` owns that keyboard and focus
contract, while every consumer owns stable tab and panel IDs, panel content,
and domain side effects.

Settings and Staff Tools use the shared `WorkspaceTabs` presentation. Recipe
detail sections, the public instruction reader, and the draft instruction
editor use the same headless roving behavior with their own visual treatment.

## Shared presentation contracts

- `workspace-panel-shell` owns the common border, surface, default radius,
  clipping, and forced-colors treatment for blocking workspace frames. A
  reviewed consumer may set `--workspace-panel-radius` for its desktop radius.
- `workspace-panel-body` owns the identical body surface, minimum height, and
  default padding used by My Recipes, Saved Recipes, and Connections.
- `workspace-panel-shell--mobile-bleed` opts a shell into the shared 700 px
  edge-to-edge behavior. The feature may set
  `--workspace-panel-mobile-gutter`; the default is `0.75rem`.
- `WorkspaceTabMenu`, `WorkspaceTabItems`, `WorkspaceTabButton`, and
  `WorkspaceTabCount` share menu markup and styling without changing its
  semantic model.
- Shared counts are visual supplements and remain hidden from accessible names.

Feature classes continue to own widths, shadows, intentional radius overrides,
content layout, responsive content padding, and domain-specific states.

## Consumer inventory

| Surface | Model | Shared frame/body | Responsive exception |
| --- | --- | --- | --- |
| Activity | Dataset filters | Panel shell | 700 px bleed, `0.75rem` gutter |
| Community activity | No selector menu | Panel shell | 700 px bleed, `0.75rem` gutter |
| My Recipes / Saved | URL-backed views | Panel shell and body | 700 px bleed, `1rem` gutter |
| Connections | URL-backed views | Panel shell and body | 700 px bleed, `1rem` gutter; feature shadow retained |
| Member ingredient requests | Dataset filters | Panel shell | Intentional 650 px bleed boundary |
| Settings | In-page panels | Panel shell and `WorkspaceTabs` | 700 px bleed, `0.75rem` gutter |
| Staff Tools | In-page panels | Panel shell and `WorkspaceTabs` | 700 px bleed, `0.75rem` gutter |
| Curator and moderator workspaces | Dataset filters or domain workspace | Nested panel shell | Does not use the outer-shell bleed modifier |

## Specialized tab behavior

- Recipe detail tabs keep deep-link hash aliases and update the canonical hash
  without adding browser-history entries. Hash-driven changes do not move
  keyboard focus.
- Public instruction tabs switch between readable steps and the structured
  cooking breakdown while keeping both panels feature-owned.
- Draft instruction tabs retain the requested view when validation temporarily
  forces the cooking breakdown to be visible. The surrounding disabled
  fieldset continues to disable both tabs and editor controls.
- Staff Tools renders only tabs allowed by the loaded capabilities and retains
  its existing fallback when no tool is available.

## Change checklist

When adding or changing a workspace menu:

1. Choose URL navigation, dataset filtering, or in-page tabs based on user
   behavior rather than visual similarity.
2. Reuse the shared shell, body, menu, or roving behavior only where its full
   contract applies.
3. Keep URL parsing, requests, authorization, validation, hashes, and panels in
   the owning route or feature.
4. Test shared mechanics once and test only the feature's meaningful contract
   at the route level.
5. Check desktop, phone, the 650–700 px transition, horizontal overflow,
   forced colors, and WCAG A/AA behavior before changing a responsive contract.
