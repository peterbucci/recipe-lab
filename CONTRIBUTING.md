# Contributing to Recipe Lab

## Branch names

Name branches after the work they contain, never after the person or tool that
created them.

Use this format:

```
<type>/<optional-work-item>-<concise-kebab-case-summary>
```

Use lowercase names, a single slash, and a short descriptive suffix. When work
belongs to an RCP, put its identifier immediately after the type.

| Type | Use for | Example |
| --- | --- | --- |
| `feature/` | Product work and RCP workstreams | `feature/rcp-52c-comparison-hero-navigation` |
| `fix/` | Bugs and correctness issues | `fix/account-handle-truncation` |
| `refactor/` | Behavior-preserving restructuring | `refactor/frontend-api-client` |
| `test/` | Test stability, coverage, and visual baselines | `test/visual-baseline-review` |
| `docs/` | Documentation | `docs/consolidate-project-documentation` |
| `ops/` | Sandboxes, deployment, and operational automation | `ops/ephemeral-sandbox-deployment` |
| `maintenance/` | General upkeep and CI policy | `maintenance/ci-and-dependency-updates` |
| `deps/` | Dependency-only updates | `deps/vite-8-plugin-react-6` |
| `safety/` | Incident response and remediation | `safety/rcp-33c-accidental-main-20260827` |

Do not use author, agent, or tool prefixes such as `codex/`. Do not rename
historical branches solely to conform to this policy; delete fully merged
branches when they are no longer needed instead.

## Branch lifecycle

Create new work from an up-to-date `main`, use one branch for one coherent
change, and delete the remote branch once its work is merged and no longer
needed for review or deployment.
