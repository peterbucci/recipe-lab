# Frontend organization baseline — 2026-09-05

This is the immutable starting inventory for RCP-49. It was captured from commit
`c60b668d95242074cbf65c1e5213514822cc08db` before the first ownership move.

## Legacy ownership concentration

| Location | Total source/test files | Production | Tests | Test support |
|---|---:|---:|---:|---:|
| `frontend/app/components` | 169 | 93 | 71 | 5 |
| `frontend/lib` | 85 | 44 | 41 | 0 |

The new architecture audit accounted for 342 JavaScript/TypeScript runtime,
test, and support files. Of those, 254 were in the two migration-owned legacy
locations above. The application also began with 56 Next route entry files and
32 stylesheets under the existing `app/styles` manifest.

## Executed verification baseline

| Check | Result |
|---|---|
| Full Vitest suite | 153 files, 912 tests passed |
| Coverage | 84.70% statements, 79.58% branches, 89.97% functions, 86.99% lines |
| Production-source reachability | 199 modules from 57 runtime entries, passed |
| Browser discovery | 17 smoke, 23 acceptance, 1 performance, 1 release, 170 visual |
| Documentation links | Passed |
| Frontend ownership audit | 342 files accounted for, passed |

Generated coverage output remains ignored and was not committed. Existing
approved visual baselines were not changed.

## Preservation contract

RCP-49 must retain:

- the 912 current unit, component, route, contract, and tooling assertions;
- every browser suite and its execution mode;
- the 199-module production reachability inventory, adjusted only for moves;
- API wire schemas, error classes, retry behavior, and session/CSRF behavior;
- route URLs, redirects, permissions, product language, and accessibility;
- the stylesheet manifest order and approved visual baseline pixels; and
- a cycle-free production import graph.

Counts may rise when an architectural boundary gains a focused test. A lower
count requires explicit review evidence that a test was intentionally replaced,
not silently omitted by a path change.
