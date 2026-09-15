# RCP-53 recipe editions and corrections certification

Evidence window: 2026-09-14 through 2026-09-15

This record covers the RCP-53 implementation candidate on
`codex/recipe-editions-and-corrections`. It records architectural ownership,
story coverage, and final merge-certification evidence. The RCP-53 code,
invariant, real-database, browser, and committed-source-package gates described
here passed. This is not a production-release certificate: the full RCP-33
production-image release rehearsal remains a separate gate described below.

## Story map

| Story | Candidate responsibility |
| --- | --- |
| RCP-53A | Add stable `Recipe` identity and append-only recipe-local `RecipeEdition` topology while preserving every legacy immutable version, timestamp, lineage edge, interaction, and publication. |
| RCP-53B | Distinguish original, adaptation, and revision drafts; authorize owner-current revision creation; and publish one exact same-recipe successor atomically and idempotently. |
| RCP-53C | Resolve explicit stable current editions across public discovery and private libraries without hiding exact immutable version identity or falling back from a hidden current. |
| RCP-53D | Present backend-derived revision capability and keep revision authoring, stale-draft recovery, navigation blocking, and async resource identity in their existing frontend owners. |
| RCP-53E | Expose bounded readable recipe-local history and current adaptation branches with exact topology IDs but no hidden descriptive data. |
| RCP-53F | Publish an author-declared correction and optionally withdraw its exact predecessor in the same transaction, while moderation retains precedence and publication intent remains unambiguous. |
| RCP-53G | Export strict evaluation snapshot v3 topology, eligibility cutoff, publication time, and governed fingerprint metadata without reinterpreting legacy snapshots or turning correction labels into verified truth. |
| RCP-53H | Add the two-cook acceptance seam, map focused invariant evidence, and document monitoring, rollback, restore, and fail-closed operational handling. |

## Preserved ownership

`RecipeVersion` remains the immutable published content snapshot. `Recipe` owns
stable identity, active owner authority, and the constrained current pointer;
`RecipeEdition` owns append-only same-recipe order and topology. Private intent
stays on `RecipeDraft`. The draft service owns creation authorization, and the
publication service/repository transaction owns locks, source revalidation,
version allocation, edition insertion, receipt/event evidence, optional safety
withdrawal, rollback, and commit.

The canonical visibility policy remains the authority for public reads.
Moderation and account lifecycle retain their existing transactions. Public
history returns weak author-declared `correction` or `update` metadata but does
not infer safety, quality, or verified meaning from it. Cross-feature frontend
composition remains in `app`; shell and shared primitives did not acquire
recipe policy.

## Two-cook acceptance seam

`test_two_cook_correction_journey_preserves_the_adaptation_exact_source` in
`backend/tests/test_recipe_publication_api.py` is the one new coherent
PostgreSQL journey. It proves this sequence through real API, service,
repository, and database boundaries:

1. Cook A publishes original v1 and receives one stable recipe identity.
2. Cook B creates and publishes an adaptation pinned to exact v1.
3. While v1 is readable, the adaptation's implicit public comparison resolves
   exact v1 as its base.
4. Cook A publishes correction v2 and atomically author-withdraws v1.
5. Stable-current resolution returns exact v2.
6. Exact v1 returns the same neutral not-found contract as an unknown version.
7. Cook B's adaptation remains readable. Its hidden nested source description
   is omitted, its default public comparison is now unavailable by the same
   public-read policy, and its stored exact parent remains v1.

The journey does not duplicate the complete rollback, concurrency,
moderation, interaction, deletion, or migration matrices. Those invariants
remain in smaller focused tests below.

## Focused invariant coverage

| Invariant | Evidence owner |
| --- | --- |
| Deterministic legacy backfill preserves versions, timestamps, publications, interactions, and topology | `test_stable_recipe_migration_preserves_legacy_rows_and_replays_deterministically` in `backend/tests/test_recipe_edition_migration.py` |
| Lossy stable-edition downgrade fails closed after a revision creates multiple parent-null versions in one lineage | `test_stable_recipe_migration_refuses_downgrade_after_a_revision` in `backend/tests/test_recipe_edition_migration.py` |
| Draft-kind backfill is deterministic; revision intent cannot be downgraded into adaptation | `test_draft_kind_migration_backfills_shape_and_rebinds_creation_intent` and `test_draft_kind_downgrade_fails_closed_when_revision_intent_exists` in `backend/tests/test_recipe_draft_kind_migration.py` |
| Same-recipe predecessor, recipe-local order, latest-current, cross-recipe adaptation, publication completeness, and append-only topology are database-enforced | Focused cases in `backend/tests/test_recipe_edition_schema.py` |
| Only the active stable owner can create/resume a revision draft for the readable exact current version | `test_revision_draft_creation_is_owner_current_scoped_and_resumable_by_kind` in `backend/tests/test_recipe_publication_api.py` |
| A stale revision conflict preserves the private draft | `test_revision_publication_advances_one_stable_recipe_and_stales_sibling_draft` in `backend/tests/test_recipe_publication_api.py` |
| Two real sessions racing the same current pointer produce one successor and one recoverable stale conflict | `test_concurrent_revision_publications_choose_one_current_successor` in `backend/tests/test_recipe_publication_api.py` |
| Revision idempotency is exact; successor engagement starts empty; revisions emit edition/receipt evidence rather than fork preference | `test_revision_publication_advances_one_stable_recipe_and_stales_sibling_draft` in `backend/tests/test_recipe_publication_api.py` |
| An adapted recipe keeps its original exact cross-recipe source through later same-recipe revisions | `test_revision_of_adaptation_keeps_the_cross_recipe_source_pinned` in `backend/tests/test_recipe_publication_api.py` |
| Safety correction withdrawal, visibility audit, failure rollback, and exact replay are atomic | `test_correction_withdrawal_is_atomic_audited_and_replay_safe` in `backend/tests/test_recipe_publication_api.py` |
| Revision publication cannot restore a moderation-hidden source; moderator restore cannot erase author withdrawal | `test_revision_publish_never_restores_a_moderation_hidden_source` in `backend/tests/test_recipe_publication_api.py` and `test_moderator_restore_preserves_an_author_withdrawal` in `backend/tests/test_moderation_api.py` |
| Current-only browse/library behavior and hidden-current no-fallback semantics | `test_hidden_current_never_falls_back_or_leaks_through_an_exact_read`, `test_discovery_and_authored_libraries_show_only_current_editions`, and `test_saved_library_stays_pinned_and_only_links_a_readable_newer_current` in `backend/tests/test_recipe_current_api.py` |
| History omits hidden descriptions, retains exact source/predecessor topology, lists revised adaptations correctly, and closes READ COMMITTED visibility/current races | Focused `test_history_*` cases in `backend/tests/test_recipe_current_api.py` |
| History independently caps editions and adaptations at 100 without row-dependent query growth | `test_history_caps_each_collection_without_row_dependent_query_growth` in `backend/tests/test_recipe_current_api.py` |
| Account deletion and recovery clear stable owner authority while preserving attribution, current pointer, and public topology | `test_account_deletion_tombstones_authorship_and_erases_private_member_state` in `backend/tests/test_account_lifecycle.py` and `test_replay_handles_deletable_deleted_and_absent_members_without_losing_public_topology` in `backend/tests/test_account_deletion_recovery.py` |
| Evaluation snapshot v3 validates and exports topology, cutoff eligibility, privacy exclusions, and legacy v1/v2 compatibility | Focused cases in `ml/tests/test_dataset.py` and `ml/tests/test_postgres_source.py` |
| A regenerated evaluation export after account deletion removes the deleted member's event while preserving eligible anonymous recipe topology | `test_export_reads_occurrence_preserving_structured_measures_from_migrated_postgres` in `ml/tests/test_postgres_source.py` |

## Operational evidence

The [stable recipe edition operations runbook](../recipe-edition-operations.md)
defines zero-row integrity checks, privacy-safe monitoring, the minimum
compatible application rollback capability, isolated restore/re-upgrade order,
and the fail-closed boundary that forbids ordinary snapshot or edition repair.
The general [release rehearsal](../release-rehearsal.md) remains authoritative
for image identity, deletion-ledger replay, smoke tests, and evidence handling.

The stable RCP-32 community rehearsal was also exercised against the pinned
PostgreSQL 17.11 image. It completed migration up/down/up and drift checks, a
production frontend build, its one guarded browser journey, live verification,
custom-format dump and isolated restore, restored-database drift verification,
byte-identical live/restored verifier summaries, and a privacy scan of nine
evidence files with zero findings. That proves the existing community restore
boundary for this candidate; it does not substitute for the broader RCP-33
production-image rehearsal.

## Verification recorded for this workspace

| Check | Result during 2026-09-14 through 2026-09-15 |
| --- | --- |
| Complete backend suite on a fresh real PostgreSQL database | **Passed: 880 tests, with 1 expected environment-gated skip, in 18:22.** The run included the migration suite rather than substituting mocks for database evidence. |
| Complete evaluation suite | **Passed: 340 tests.** This includes snapshot-v3 topology/cutoff validation, legacy compatibility, PostgreSQL extraction, and the deletion-then-regenerated-export assertion. |
| Complete frontend unit/component suite | **Passed: 192 test files and 1,065 tests.** |
| Frontend and repository static gates | **Passed.** Lint, TypeScript, generated API-contract parity, frontend architecture, CSS architecture, source reachability, and the production build were all green. |
| Playwright mode discovery | **Passed.** Discovery found exactly 17 smoke, 24 acceptance, 1 performance, 1 release, and 192 visual project cases. These counts prove routing to each mode; they do not claim that discovery alone executed a mode. |
| Clean browser smoke run | **Passed: 17/17.** |
| Fresh real-stack browser acceptance run | **Passed: 24/24** against newly migrated application state. This includes the RCP-53 recipe-edition journey rather than only synthetic visual-fixture coverage. |
| Canonical visual and accessibility gate | **Passed with zero pixel failures:** 100 cases passed and 92 expected cross-project cases skipped, for all 192 discovered project cases. The run used `mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac` and regenerated only RCP-53-affected PNGs before a final no-update pass. |
| Stable RCP-32 PostgreSQL 17.11 community rehearsal | **Passed.** Migration down/up and drift checks, production build, release browser journey 1/1, live verification, dump/restore, restored drift verification, live/restored byte equality, and the nine-file privacy scan all passed with zero privacy findings. |
| Repository source-package support tests | **Passed: 124 tests plus 71 subtests.** This verifies the packaging scripts and policy harness, but is not the deterministic audit of an eventual committed candidate ref. |
| Deterministic source-package audit of the final committed ref | **Passed.** The committed candidate was exported twice from a clean tree. Both independently generated archives were byte-identical, both manifests were byte-identical, all 100 tracked PNGs matched their reviewed Git object IDs, and both the commit-tree and completed-archive secret scans reported zero findings. |
| Full RCP-33 production-image release rehearsal | **Not run.** Image identity, vulnerability scanning, deletion-ledger replay, compatible ancestor-image rollback, and compiled release evidence remain production-release requirements; this omission is not presented as a pass. |

## Release boundary

The evidence above completes RCP-53 merge certification for this committed
candidate: the complete backend, ML, frontend, static, clean smoke, fresh
real-stack acceptance, canonical visual, deterministic source-package, and
stable RCP-32 community gates all passed. Normal review and local integration
may proceed without mislabeling the remaining release-only rehearsal as failed
RCP-53 behavior.

Before release or deployment, complete the full RCP-33 production-image release
rehearsal. If the release ref differs from this certified merge candidate,
repeat the deterministic source-package audit for that exact ref. Any nonzero
stable-recipe integrity query, lossy downgrade attempt, generated-contract
drift, privacy finding, source-package mismatch, or release-rehearsal failure
blocks release rather than authorizing a manual repair.

RCP-54 exceptional privacy or security erasure remains a separate,
unimplemented launch gate requiring legal/DPO policy and a strongly
authenticated privacy authority. Neither RCP-53 certification nor any test in
this record creates an exceptional mutation path for published content.
