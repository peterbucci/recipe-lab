# Canonical visual reference repair — 2026-09-04

## Reason and provenance

The first integration merge-readiness run exposed 64 reference mismatches, each
repeated twice, in the pinned Linux visual job. The previous reference refresh
at `24d01c8` had local Windows comparison evidence but no recorded canonical
Linux generation evidence. Full-resolution review found platform-dependent
text rasterization, fallback symbol sizing, small header-width shifts, and
occasional one-pixel scroll-position shifts, not substantive content or layout
regressions.

The replacements use the already-generated canonical capture bytes from
[CI run 33929402522](https://github.com/peterbucci/recipe-lab/actions/runs/33929402522),
job `101204827921`, source commit `093113da`, sanitized visual-differences
artifact `9958184378`. This is an explicit reviewed reference repair, not an
automatic promotion or a claim that the failed capture run passed.

After those references were repaired, the next pinned run reached 12 later
snapshots that the earlier failures had prevented from executing. Their
replacements use the canonical capture bytes from
[CI run 33932130909](https://github.com/peterbucci/recipe-lab/actions/runs/33932130909),
job `101212726598`, source commit `2f57b273`, sanitized visual-differences
artifact `9959039935`. Both repetitions produced byte-identical actual and diff
PNGs for all 12 cases. Original-resolution review again found only
Linux-versus-Windows text, icon, and control-edge rasterization differences;
content, wrapping, layout geometry, control state, and responsive placement
were unchanged.

The runner used the existing immutable linux/amd64 container:

```text
mcr.microsoft.com/playwright:v1.62.1-noble@sha256:c091b21d9fae78c76e85cd4356431e9b018402f172a214fc7d7a5e9a7e29d8ac
```

CI asserted Playwright 1.62.1 and Chromium 151.0.7922.34. Node 22.23.2, the
lockfile, bundled font files, fixtures, clock, network isolation, viewports,
and screenshot configuration follow the unchanged
[visual execution contract](../regression-baselines.md).

Production component and API refactors occurred after `24d01c8`; this review
does **not** claim those sources are identical. The baseline harness, fixtures,
configuration, package lock, and pinned runtime stayed unchanged, and the only
CSS changes in that range removed trailing blank lines. Between the capture
commit `093113da` and the repair's parent `035f0dc`, neither visual product
code nor visual harness inputs changed: only performance readiness and
release-rehearsal fixtures changed.

## Review scope

Every changed expected, actual, and diff PNG was opened at original resolution.
The review checked copy, wrapping, panel geometry, visible controls, focus
rings, validation and error messages, disabled states, synthetic staff
information, and responsive clipping/overflow. No substantive regression was
found. Linux fallback hearts, rating stars, arrows, and staff diamonds differ
in size; related intrinsic widths move slightly without overlap or new
clipping. Images contain only the existing invented baseline data.

| Project | Reviewed reference names |
| --- | --- |
| baseline-desktop-chromium | `account-access-intermediate-normal`, `account-activity-normal`, `account-activity-normal-intermediate`, `account-settings-profile-intermediate-normal`, `account-settings-profile-normal`, `auth-callback-error-intermediate`, `authoring-entry-desktop-normal`, `catalog-empty`, `catalog-intermediate-normal`, `catalog-normal`, `community-rules-normal`, `cook-profile-normal`, `cook-profile-sparse-owner`, `draft-editor-intermediate-normal`, `draft-editor-validation`, `draft-fork-header-normal`, `draft-ingredient-editor-normal`, `draft-publish-dialog`, `draft-similarity-publication-review`, `home-account-navigation`, `home-intermediate-normal`, `home-normal`, `ingredient-request-staff-review`, `ingredient-request-staff-review-intermediate`, `my-ingredient-requests`, `my-ingredient-requests-intermediate`, `my-recipes-intermediate-normal`, `my-recipes-normal`, `onboarding-form-normal`, `private-workspace-expired-session`, `private-workspace-failure`, `private-workspace-loading`, `recipe-comparison-intermediate-normal`, `recipe-comparison-normal`, `recipe-detail-error`, `recipe-detail-intermediate-normal`, `recipe-detail-normal`, `recipe-detail-unavailable`, `recipe-moderation-staff-review`, `recipe-moderation-staff-review-intermediate`, `staff-tools-normal`, `staff-tools-normal-intermediate`, `stale-curation-decision` |
| baseline-phone-chromium | `account-activity-normal`, `account-settings-profile-normal`, `catalog-normal`, `community-rules-normal`, `cook-profile-normal`, `cook-profile-sparse-owner`, `draft-editor-validation`, `draft-fork-header-normal`, `draft-ingredient-editor-normal`, `draft-similarity-publication-review`, `draft-unresolved-ingredient-validation`, `global-not-found`, `home-account-navigation`, `home-normal`, `ingredient-request-staff-review`, `my-ingredient-requests`, `my-recipes-normal`, `recipe-comparison-normal`, `recipe-detail-normal`, `recipe-moderation-staff-review`, `staff-tools-normal` |

The follow-up review covered these additional references:

| Project | Reviewed reference names |
| --- | --- |
| baseline-desktop-chromium | `account-activity-saved-filtered`, `account-settings-danger-intermediate-normal`, `account-settings-danger-normal`, `draft-instruction-editor-normal`, `recipe-instructions-normal`, `staff-tools-moderator-selected-intermediate`, `staff-tools-moderator-selected` |
| baseline-phone-chromium | `account-activity-requests-filtered`, `account-settings-danger-normal`, `draft-instruction-editor-normal`, `recipe-instructions-normal`, `staff-tools-moderator-selected` |

All 64 cases had two independent captures. For 63 cases the capture bytes were
identical. The phone account-navigation pair differed in only ten pixels at
x=12–13, y=514–535, with a maximum RGB-channel delta of 1; both diff images were
identical. This is below the unchanged comparator's color threshold, not a
reason to change its zero differing-pixel allowance.

Existing evidence limitations remain: the desktop authoring-entry reference
shows the loading skeleton in both versions; the generically named
intermediate editor reference shows a publication dialog; horizontally
scrollable category/tab strips and below-fold crops are not evidence that
every item is simultaneously visible. These repairs do not expand those
coverage claims.

## Repair and required verification

Instead of rerunning update mode solely to regenerate the reviewed bytes,
this repair copies the canonical captures into their existing expected
`frontend/baselines/{project}/{name}.png` paths. Across the initial and
follow-up repairs, only the 76 reviewed expected files and their exact Git blob
IDs in `EXPORT_POLICY` change. Artifact directories, actual/diff filenames,
reports, and private browser evidence remain excluded.

No application code, fixture state, screenshot threshold, timeout, retry,
skip, browser version, or accessibility rule changes in this repair. The
capture run reported 48 passed, 128 failed screenshot comparisons, and 164
expected viewport skips across two repetitions. A screenshot failure can
prevent later assertions from running, so that run is not complete
accessibility or behavioral acceptance evidence. The follow-up capture run
reported 152 passed, 24 failed screenshot comparisons, and 164 expected
viewport skips across two repetitions; its 24 failures were the 12 additional
reviewed references repeated twice. It likewise is provenance, not a passing
gate.

Before merge, the repaired final revision must pass the normal pinned-image
comparison with `--repeat-each=2`, its accessibility and keyboard assertions,
the exact opaque-object audit, source-packaging tests, and all required
release checks. Their final run links and outcomes belong in the merge pull
request; this document records reference provenance, not a preemptive pass.
