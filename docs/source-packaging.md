# Safe source packaging

RCP-33A provides one fail-closed command for sharing a committed Recipe Lab
source revision. The command packages Git objects from an explicit commit. It
does not walk, copy, or secret-scan the working tree, so ignored local files
such as the root `.env` are never opened or placed in the archive.

## Canonical command

Run the command from the root of a clean Recipe Lab checkout and write the
result outside the repository:

```powershell
$revision = git rev-parse --verify 'HEAD^{commit}'
$shortRevision = $revision.Substring(0, 12)
$exportDirectory = Join-Path ([System.IO.Path]::GetTempPath()) `
  ("recipe-lab-source-" + [System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $exportDirectory | Out-Null
$archive = Join-Path $exportDirectory "recipe-lab-source-$shortRevision.zip"
python scripts/package_source.py --ref $revision --output $archive
```

`--ref` is required and may name a commit, tag, or branch that resolves to a
commit. The full resolved commit SHA is recorded in the report. `--output` is
also required, must end in `.zip`, and must be outside the checkout. The tool
never overwrites an existing archive or manifest and has no force option.

The tree must have no staged changes, unstaged changes, or non-ignored
untracked files. Commit the implementation you intend to share before running
the command. An ignored `.env` does not make the tree dirty and remains outside
both scans. The clean-tree check is repeated immediately before publication so
a concurrent edit also stops the export.

## One policy and its limits

`EXPORT_POLICY` in `scripts/package_source.py` is the single versioned source
of truth for both allowlists and resource bounds. Its SHA-256 fingerprint and
the active limits are recorded in every manifest. Changing the policy requires
code review and its tests run in CI.

The version 5 bounds are:

| Bound | Limit |
| --- | ---: |
| Tracked files | 2,000 |
| Complete archive path | 512 UTF-8 bytes |
| Individual file | 10 MiB |
| Total uncompressed content | 25 MiB |
| Physical ZIP archive | 25 MiB |

Only regular tracked blobs with mode `100644` or `100755` are eligible. The
policy explicitly allows the `.github`, `backend`, `docs`, `frontend`, `ml`,
and `scripts` source trees plus a small set of reviewed root files and source
extensions. The root `.dockerignore`, `pyproject.toml`, and `uv.lock` are
explicit reviewed additions so an exported revision retains its Docker-context
boundary, Python workspace, and exact dependency graph. Member-local or nested
lockfiles remain rejected rather than creating a second dependency authority.
Reviewed documentation images and committed RCP-34B visual-regression goldens
are opaque to text scanning, so every eligible PNG is bound to an explicitly
reviewed Git object ID. A changed or new opaque file fails until both the image
and the corresponding `reviewed_opaque_git_objects` entry are reviewed. This is
intentional: accepting a screenshot change and authorizing that binary for a
source package are one review decision, not an automatic side effect of running
Playwright.

### Auditing the opaque-file policy

Use the read-only audit before packaging or after a reviewed baseline update:

```powershell
python scripts/package_source.py --ref HEAD --audit-opaque-policy
```

The JSON report compares the tracked PNG objects in the selected commit with
the manual policy and lists every missing path, mismatched object ID, and stale
policy entry. It exits nonzero when any drift exists. The audit reads Git
objects rather than working-tree files, does not require a clean checkout, and
never updates the policy. After visually reviewing an intentional PNG change,
copy the reported object ID into `reviewed_opaque_git_objects` by hand and have
that policy edit reviewed with the image.

The command rejects rather than silently omits:

- every environment file except the exact root `.env.example`;
- private-key, credential, nested-archive, dependency, cache, build, coverage,
  report, browser-output, and test-output paths;
- Git repository metadata, `.gitmodules`, submodules, symlinks, and Git LFS
  pointer blobs;
- non-UTF-8 text or unreviewed binary files;
- absolute, traversal, drive-qualified, backslash, control-character,
  bidirectional-control, non-normalized, overlong, or Windows-reserved paths;
- duplicate paths and portable case-insensitive path collisions; and
- files, extensions, or top-level directories not present in the allowlist.

## Two secret scans and archive verification

The bundled, versioned `recipe-lab-source-secret-scan` rules inspect the exact
committed blobs before any ZIP is created. The rules detect private-key headers,
high-confidence provider credential formats, and high-entropy values assigned
to credential-bearing names while recognizing explicit test and local-example
placeholders. Findings report only a rule ID, validated repository path, and
line number; matched values and source lines are never printed.

After writing a temporary deterministic ZIP, the command reopens it without
extracting it. It requires the exact expected paths, modes, sizes, SHA-256
hashes, entry count, and limits, then scans the reopened contents again. A
missing scan, scanner exception, structural mismatch, secret finding, dirty
tree, or publication error deletes temporary and partial output and exits
nonzero.

Successful output consists of:

- the deterministic ZIP rooted at `recipe-lab-<commit-sha-prefix>/`; and
- `<archive>.manifest.json`, a deterministic report containing the full commit
  SHA, policy and scanner-ruleset fingerprints, limits, archive SHA-256 and
  sizes, file count, every included path/mode/size/hash, opaque-file count, and
  both scan results.

The ZIP has sorted entries, normalized modes, a fixed timestamp, no comment,
and a fixed compression level. Repeated exports of the same commit are
byte-identical under the pinned Python 3.13 CI runtime. Output filenames and
wall-clock time do not enter the archive or manifest.

## Security boundary and CI

Secret scanning is defense in depth, not proof that source is safe. It cannot
reliably inspect arbitrary information rendered inside reviewed images, and it
scans the selected revision rather than all Git history. If a credential was
ever committed, shared, or otherwise exposed, revoke or rotate it through the
private provider workflow; deleting it or passing this command does not make it
safe again. Never put credential values or incident evidence in a public issue.

The `Safe source package` CI job runs the standard-library test suite, exports
the pull-request commit twice, and compares the archive and manifest bytes. It
writes only to the runner's temporary directory, never uploads the package, and
deletes every generated file even when the job fails. The stable RCP-32
aggregate gate also requires this job to pass.

RCP-34B expected screenshots under `frontend/baselines/` are committed source,
not generated CI diagnostics. After an intentional golden update, reviewers
must inspect every changed image, calculate its Git blob ID with
`git hash-object -- <path>`, and add or replace the exact path/object pair in
`EXPORT_POLICY`. The source-packaging tests must then pass before the revision
is eligible for export. Actual and diff PNGs, Playwright JSON output,
performance observations, and performance baseline candidates remain under
`frontend/test-results/`; the exporter rejects that tree and those files must
never be promoted into the opaque allowlist. The reviewed public performance
baseline in `docs/baselines/` is UTF-8 JSON and therefore receives both normal
secret-scan passes rather than opaque treatment. See
[deterministic regression baselines](regression-baselines.md) for the visual and
performance review workflow.

Disposable screenshots produced during local review belong under the root
`artifacts/` directory. That directory is ignored by Git and rejected by the
source exporter; do not move its files into the reviewed opaque policy. Delete
local artifacts when the review is complete.
