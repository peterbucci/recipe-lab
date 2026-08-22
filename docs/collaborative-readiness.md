# Collaborative-filtering data readiness

## Purpose and boundary

RCP-18A provides a deterministic way to generate an engineering cohort and a
fixed gate for deciding whether an evaluation snapshot has enough structural
support to begin offline collaborative-filtering work. It does not implement a
collaborative model, change the recommendation API, add a frontend surface, or
make a production-readiness decision.

A `ready` result means only that the snapshot meets the documented profile,
item, interaction, support, sparsity, and temporal-evaluation minimums. It does
not show that a model is accurate, useful, representative of real people, or
safe to serve.

## Versioned synthetic cohort

The committed `ml/tests/fixtures/readiness_catalog_v1.json` file is an invented,
catalog-only evaluation snapshot. It contains eight recipe versions and no
events. The simulator refuses a catalog that already contains events, so
recorded and synthetic activity cannot be silently combined.

Run the default cohort from `ml/`:

```powershell
recipe-lab-eval simulate `
  --catalog tests/fixtures/readiness_catalog_v1.json `
  --profiles 64 `
  --seed 20260822 `
  --output snapshots/readiness-simulated-v1.json
```

The version-one simulator uses these fixed behavioral assumptions:

- 64 opaque profiles by default;
- five distinct pre-cutoff training items and two distinct, previously unseen
  holdout items per profile;
- one view plus one save or rating event for every selected item;
- a 28-day training window and a seven-day holdout window derived from the
  catalog cutoff, never the current time;
- deterministic round-robin training exposure, with pre-cutoff save and rating
  values from a fixed ingredient-affinity heuristic; and
- deliberately positive holdout actions so temporal evaluation plumbing can be
  exercised.

Those defaults produce 640 training events, 256 holdout events, 320 distinct
training profile-item pairs, and 128 eligible relevant holdout items for the
eight-item fixture. Fork events are intentionally omitted because the snapshot
does not encode lineage; inventing a related child would give the event a false
meaning.

The seed, canonical available-at-cutoff catalog fingerprint, and simulator
configuration determine all profile IDs, event IDs, event ordering, timestamps,
and the derived dataset ID. Equivalent inputs produce byte-identical snapshots.
A changed seed produces a distinct but still valid cohort. The input recipes are
retained unchanged, including catalog rows unavailable at the cutoff; those rows
receive no events and cannot change the generated cohort.

## Privacy contract

Generated profiles and events use UUIDv5 identifiers and the existing typed
event fields only. The simulator adds no names, email addresses, IP addresses,
user-agent or device data, search text, request fingerprints, or free-form
personal context. It also carries fixed simulation assumptions in the snapshot
limitations.

The catalog itself remains caller-supplied input and can contain recipe titles,
a dataset label, and limitation text. Use only an intentionally selected,
versioned catalog. Deterministic opaque identifiers are suitable for this
synthetic fixture; they are not a technique for anonymizing real personal data.

## Readiness gate

Assess either a simulated snapshot or an intentionally captured evaluation
snapshot:

```powershell
recipe-lab-eval readiness `
  --snapshot snapshots/readiness-simulated-v1.json `
  --output reports/readiness-v1.json `
  --strict
```

The `fixed-cutoff-collaborative-readiness-v1` protocol uses the same strict UTC
cutoff and eligible holdout-label rules as the offline evaluator. Its versioned
defaults are:

| Check | Minimum | Definition |
| --- | ---: | --- |
| Training profiles | 50 | Profiles with at least one pre-cutoff event |
| Available items | 8 | Recipe versions created strictly before the cutoff |
| Training events | 500 | Typed event rows strictly before the cutoff |
| Supported profiles | 40 | Profiles with at least five distinct training items |
| Supported items | 8 | Items observed from at least three distinct training profiles |
| Observed training pairs | 200 | Distinct training profile-item matrix cells |
| Temporal evaluation profiles | 20 | Eligible holdout profiles that also have supported training history |
| Temporal relevant items | 20 | Eligible unseen positives belonging to those supported profiles |

The report also records total, observed, and unobserved matrix cells and exact
density and sparsity fractions. Repeated event rows can raise the event count,
but they cannot invent distinct profile-item support. Holdout-only activity and
recipes unavailable at the cutoff likewise cannot inflate training readiness.

Every check records its actual value, minimum, pass state, and stable failure
reason. The overall status is `ready` only when every check passes; otherwise it
is `insufficient_data` and every failed reason appears in the report. Reports
contain aggregate counts, the snapshot schema, fingerprint, cutoff, thresholds,
and fixed gate limitations. They intentionally omit the caller-controlled
dataset ID and snapshot limitation text as well as recipe titles and raw recipe,
event, or profile IDs. Simulator assumptions remain in the versioned generated
snapshot and this document; they are not copied into the aggregate report.
Canonical JSON omits wall-clock and host-path data, so equivalent inputs produce
identical bytes.

The command writes an insufficient report and exits successfully by default.
Use `--strict` for an evaluation-only gate; it writes the same report and exits
with status 3 when data is insufficient. Invalid input or configuration exits
with status 2, and read/write failures exit with status 1. The CLI refuses to
overwrite its input catalog or snapshot.

## When RCP-18 may proceed

A ready report from the generated cohort permits implementation and testing of
an offline RCP-18 collaborative-filtering adapter against a stable data
contract. It is engineering evidence only. Simulated preferences are designed
to exercise overlap and temporal evaluation, not to imitate or predict people.

Claims about real interaction data require an intentionally captured,
privacy-safe snapshot to pass the same gate. Even then, readiness establishes
only that an experiment can be run: RCP-18 must still be evaluated beside
`baseline-v1` under the fixed-cutoff protocol before any quality conclusion.
Online serving, API changes, a recommendation UI, and deployment remain
separate product decisions.
