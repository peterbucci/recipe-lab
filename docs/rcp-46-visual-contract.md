# RCP-46 visual contract

**Contract version:** 1.0 (RCP-46A)  
**Applies to:** the shared application shell and every route migrated by RCP-46

This contract turns the approved layout reference into a small set of reusable
visual decisions. It is a presentation contract, not permission to add features
shown in the reference.

## Foundation

| Role | Version 1 value | Use |
| --- | --- | --- |
| Page background | `#f7f7fb` | App canvas and quiet page regions |
| Surface | `#ffffff` | Header, cards, panels, and menus |
| Primary text | `#17172b` | Headings, labels, and high-emphasis copy |
| Muted text | `#646577` | Supporting copy and metadata; passes WCAG AA on white and accent-soft surfaces |
| Accent | `#6032d5` | Primary actions and selected navigation |
| Accent strong | `#5121c3` | Hover and pressed states |
| Accent soft | `#f0ebff` | Selected or informational backgrounds |
| Border | `#e4e3ec` | Default separators and surface outlines |

- Use Inter followed by the system sans-serif stack for body text and headings.
  Weight, size, and spacing establish hierarchy; the redesign does not introduce
  a second display face.
- Use a 4 px base spacing unit. The normal scale is `4`, `8`, `12`, `16`, `24`,
  `32`, and `48` px. Prefer the smallest value that preserves a clear grouping.
- Controls use an 8 px radius and cards/panels use a 12 px radius. Reserve fully
  rounded shapes for avatars, compact badges, and controls whose shape conveys a
  real state; do not turn every action into a pill.
- Use one quiet elevation for floating menus and emphasized cards:
  `0 10px 30px rgb(23 23 43 / 0.08)`. Ordinary cards rely on a border, not a
  shadow.
- Every interactive element keeps an obvious keyboard focus indicator and a
  minimum 44 by 44 px target where space permits, especially at phone width.

## Shell and responsive widths

The desktop header is 70 px tall. Its content and page content share a centered
maximum width of 1200 px with 24 px outer gutters. A desktop-only secondary rail
may be at most 255 px wide, but it must never contain the only route to a feature.

| Width | Layout rule |
| --- | --- |
| 1200 px and wider | Full header and optional secondary rail; the main content remains the visual focus. |
| 900–1199 px | Remove any secondary rail and keep a centered, one-column content frame. |
| 700–899 px | Compact the header and page spacing while preserving the same alignment and primary routes; do not leave a centered panel beside a left-aligned sibling. |
| Below 700 px | 58 px compact header, 16 px page gutters, and stacked content. Actions keep content-sized labels unless the whole surface clearly calls for a full-width action. |

The reviewed shell evidence widths are approximately 1440, 820, and 390 px.
No width may introduce horizontal page scrolling, clipped account access, or a
breakpoint-only disappearance of the recipe catalog route.

## Product guardrails

- Preserve every existing route, account state, permission check, loading state,
  error state, and recovery path while changing presentation.
- Use only data and actions the application actually supports. The layout
  reference's notification count, cross-entity search, statistics, activity
  feed, category browser, newsletter, and “Picked for you” content are not part
  of RCP-46.
- Do not invent placeholder metrics, people, recipes, moderation work, or
  navigation destinations to make a page resemble the reference.
- Keep recipe lineage language such as **Based on** wherever it currently
  explains provenance. Do not reintroduce generic Original/Version badges on
  recipe cards.
- Keep serving size with recipe metadata rather than treating it as a version
  label.
- Existing recipe artwork remains valid. A new photo or media system is outside
  this contract.

## Change control

A later visual-contract version must record the deliberate token or breakpoint
change here, update the focused responsive checks, and include owner-reviewed
evidence at the affected widths. A route-family story may refine a component,
but it may not silently create a second palette, type system, or breakpoint
model.
