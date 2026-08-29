#!/usr/bin/env bash
# Run the isolated RCP-33G release-candidate rehearsal on a prepared CI runner.
set -euo pipefail
umask 077

REPO_ROOT="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
CURRENT_PHASE="setup"
section() {
  cd "$REPO_ROOT"
  CURRENT_PHASE="$1"
  printf "\n== %s ==\n" "$CURRENT_PHASE"
}
reload_environment() {
  set -a
  # GitHub supplies this job-specific environment file.
  # shellcheck disable=SC1090
  source "$GITHUB_ENV"
  set +a
}
scan_image() {
  local image_role="$1"
  local image_id="$2"
  local private_report="$3"
  local scan_status
  set +e
  trivy image --skip-db-update --scanners vuln,secret \
    --severity HIGH,CRITICAL --exit-code 1 --no-progress \
    --format json --output "$private_report" \
    "$image_id"
  scan_status=$?
  set -e
  if [[ "$scan_status" != "0" ]]; then
    export RCP33G_FAILED_IMAGE_ROLE="$image_role"
    export RCP33G_FAILED_IMAGE_SCAN="$private_report"
    python - <<'PY'
import os
from pathlib import Path

from scripts.rehearse_release import (
    MAX_SCAN_REPORT_BYTES,
    ReleaseEvidenceError,
    compile_image_scan_failure_summary,
    load_bounded_json_object,
    write_release_evidence,
)

try:
    scan_report = load_bounded_json_object(
        Path(os.environ["RCP33G_FAILED_IMAGE_SCAN"]),
        max_bytes=MAX_SCAN_REPORT_BYTES,
    )
except ReleaseEvidenceError:
    scan_report = None

summary = compile_image_scan_failure_summary(
    image_role=os.environ["RCP33G_FAILED_IMAGE_ROLE"],
    scanner_version=os.environ["RCP33G_TRIVY_VERSION"],
    scanner_database_revision=os.environ["RCP33G_TRIVY_DATABASE_REVISION"],
    scan_report=scan_report,
)
write_release_evidence(
    Path(os.environ["RCP33G_SAFE_DIR"]) / "failure-summary.json",
    summary,
)
PY
    exit "$scan_status"
  fi
}
cleanup() {
  local primary_status=$?
  trap - EXIT
  cleanup_result=0
  for pid_file in \
    "$RCP33G_PRIVATE_DIR/browser.pid" \
    "$RCP33G_PRIVATE_DIR/backend.pid" \
    "$RCP33G_PRIVATE_DIR/oidc.pid"; do
    if [[ -f "$pid_file" ]]; then
      pid="$(cat "$pid_file")"
      if [[ "$pid" =~ ^[0-9]+$ ]]; then
        kill "$pid" 2>/dev/null || true
      else
        cleanup_result=1
      fi
    fi
  done
  docker rm --force \
    recipe-lab-rcp33g-candidate-backend \
    recipe-lab-rcp33g-candidate-frontend \
    recipe-lab-rcp33g-rollback-backend \
    recipe-lab-rcp33g-rollback-frontend \
    > /dev/null 2>&1 || true
  for database in \
    recipe_lab_rcp33g_fresh \
    recipe_lab_rcp33g_migration_failure \
    recipe_lab_rcp32_acceptance \
    recipe_lab_rcp32_acceptance_restore; do
    docker run --rm --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      postgres:17-alpine \
      dropdb --host "$PGHOST" --username "$PGUSER" \
        --force --if-exists "$database" \
      > /dev/null 2>&1 || cleanup_result=1
  done
  docker image rm --force \
    "$RCP33G_CANDIDATE_BACKEND_IMAGE" \
    "$RCP33G_CANDIDATE_FRONTEND_IMAGE" \
    "$RCP33G_ROLLBACK_BACKEND_IMAGE" \
    "$RCP33G_ROLLBACK_FRONTEND_IMAGE" \
    > /dev/null 2>&1 || cleanup_result=1
  if [[ -d "$RCP33G_ROLLBACK_WORKTREE" ]]; then
    git worktree remove --force "$RCP33G_ROLLBACK_WORKTREE" \
      > /dev/null 2>&1 || cleanup_result=1
  fi
  rm -rf -- \
    "$RCP33G_PRIVATE_DIR" \
    "$TRIVY_CACHE_DIR" \
    "$GITHUB_WORKSPACE/frontend/test-results" \
    "$GITHUB_WORKSPACE/frontend/playwright-report" || cleanup_result=1
  if [[ ("$primary_status" != "0" || "$cleanup_result" != "0") \
    && ! -f "$RCP33G_SAFE_DIR/failure-summary.json" ]]; then
    mkdir -p -- "$RCP33G_SAFE_DIR"
    export RCP33G_FAILURE_PHASE="$CURRENT_PHASE"
    python - <<'PY' > "$RCP33G_SAFE_DIR/failure-summary.json"
import json
import os

phase = os.environ["RCP33G_FAILURE_PHASE"]
print(
    json.dumps(
        {
            "phase": "cleanup" if phase == "complete" else phase,
            "schema_version": 1,
            "status": "failed",
        },
        separators=(",", ":"),
        sort_keys=True,
    )
)
PY
  fi
  if [[ "$primary_status" != "0" ]]; then exit "$primary_status"; fi
  exit "$cleanup_result"
}
trap cleanup EXIT
reload_environment

section 'Prepare private workspace and exact source package'
install -d -m 0700 -- \
  "$RCP33G_PRIVATE_DIR" \
  "$RCP33G_SAFE_DIR" \
  "$TRIVY_CACHE_DIR"
source_archive="$RCP33G_PRIVATE_DIR/source.zip"
python scripts/package_source.py \
  --ref "$GITHUB_SHA" \
  --output "$source_archive" \
  > "$RCP33G_PRIVATE_DIR/source-export.json"
source_sha256="$(sha256sum "$source_archive" | cut -d ' ' -f 1)"
if [[ ! "$source_sha256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "The safe-source hash is invalid."
  exit 1
fi
{
  echo "RCP33G_SOURCE_ARCHIVE=$source_archive"
  echo "RCP33G_SOURCE_ARCHIVE_SHA256=$source_sha256"
  echo "RCP33G_SOURCE_MANIFEST=$source_archive.manifest.json"
} >> "$GITHUB_ENV"
install -d -m 0700 -- \
  "$RCP33G_PRIVATE_DIR/source-tree" \
  "$RCP33G_PRIVATE_DIR/backend-dependencies"
python -m zipfile -e \
  "$source_archive" \
  "$RCP33G_PRIVATE_DIR/source-tree"
uv export \
  --frozen \
  --package recipe-lab-api \
  --no-dev \
  --no-emit-project \
  --format requirements-txt \
  > "$RCP33G_PRIVATE_DIR/backend-dependencies/requirements.txt"
git worktree add --detach \
  "$RCP33G_ROLLBACK_WORKTREE" \
  "$RCP33G_ROLLBACK_SHA"
reload_environment

section 'Download and bind scanner database'
trivy image --download-db-only --no-progress
scanner_version="$(trivy --version | awk '/^Version:/ {print $2; exit}')"
if [[ "$scanner_version" != "0.74.0" ]]; then
  echo "The installed vulnerability scanner version is not reviewed."
  exit 1
fi
test -s "$TRIVY_CACHE_DIR/db/trivy.db"
database_revision="sha256:$(sha256sum "$TRIVY_CACHE_DIR/db/trivy.db" | cut -d ' ' -f 1)"
if [[ ! "$database_revision" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "The vulnerability database identity is invalid."
  exit 1
fi
echo "RCP33G_TRIVY_VERSION=$scanner_version" >> "$GITHUB_ENV"
echo "RCP33G_TRIVY_DATABASE_REVISION=$database_revision" >> "$GITHUB_ENV"
reload_environment

section 'Scan exact source and locked dependencies'
source_root="$(find "$RCP33G_PRIVATE_DIR/source-tree" -mindepth 1 -maxdepth 1 -type d)"
if [[ -z "$source_root" || "$(printf '%s\n' "$source_root" | wc -l)" != "1" ]]; then
  echo "The safe-source archive root is invalid."
  exit 1
fi
trivy fs \
  --skip-db-update \
  --scanners vuln,secret \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --no-progress \
  --format json \
  --output "$RCP33G_PRIVATE_DIR/source-scan.json" \
  "$source_root"
trivy fs \
  --skip-db-update \
  --scanners vuln \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --no-progress \
  --format json \
  --output "$RCP33G_PRIVATE_DIR/backend-dependency-scan.json" \
  "$RCP33G_PRIVATE_DIR/backend-dependencies"
reload_environment

section 'Build and verify exact candidate and rollback images'
python scripts/verify_production_images.py \
  --backend-image "$RCP33G_CANDIDATE_BACKEND_IMAGE" \
  --frontend-image "$RCP33G_CANDIDATE_FRONTEND_IMAGE" \
  --backend-context . \
  --backend-dockerfile backend/Dockerfile \
  --frontend-context frontend \
  --frontend-dockerfile frontend/Dockerfile \
  --report "$RCP33G_PRIVATE_DIR/candidate-images.json"
# Exercise the reviewed ancestor application source on the same hardened image
# recipes as the candidate. The rehearsal is proving application/schema rollback
# compatibility; RCP-21 remains responsible for binding a real prior deployment
# to its independently scanned registry digest.
cp backend/Dockerfile "$RCP33G_ROLLBACK_WORKTREE/backend/Dockerfile"
cp frontend/Dockerfile "$RCP33G_ROLLBACK_WORKTREE/frontend/Dockerfile"
docker build --pull --no-cache --target production \
  --file "$RCP33G_ROLLBACK_WORKTREE/backend/Dockerfile" \
  --tag "$RCP33G_ROLLBACK_BACKEND_IMAGE" \
  "$RCP33G_ROLLBACK_WORKTREE"
docker build --pull --no-cache --target production \
  --file "$RCP33G_ROLLBACK_WORKTREE/frontend/Dockerfile" \
  --tag "$RCP33G_ROLLBACK_FRONTEND_IMAGE" \
  "$RCP33G_ROLLBACK_WORKTREE/frontend"
(
  cd "$RCP33G_ROLLBACK_WORKTREE"
  python "$GITHUB_WORKSPACE/scripts/verify_production_images.py" \
    --backend-image "$RCP33G_ROLLBACK_BACKEND_IMAGE" \
    --frontend-image "$RCP33G_ROLLBACK_FRONTEND_IMAGE" \
    --backend-context . \
    --backend-dockerfile backend/Dockerfile \
    --frontend-context frontend \
    --frontend-dockerfile frontend/Dockerfile \
    --skip-build \
    --report "$RCP33G_PRIVATE_DIR/rollback-images.json"
)
reload_environment

section 'Scan every exact candidate and rollback image'
candidate_backend_id="$(jq -er '.images.backend.id' "$RCP33G_PRIVATE_DIR/candidate-images.json")"
candidate_frontend_id="$(jq -er '.images.frontend.id' "$RCP33G_PRIVATE_DIR/candidate-images.json")"
rollback_backend_id="$(jq -er '.images.backend.id' "$RCP33G_PRIVATE_DIR/rollback-images.json")"
rollback_frontend_id="$(jq -er '.images.frontend.id' "$RCP33G_PRIVATE_DIR/rollback-images.json")"
for identity in \
  "$candidate_backend_id" \
  "$candidate_frontend_id" \
  "$rollback_backend_id" \
  "$rollback_frontend_id"; do
  if [[ ! "$identity" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "An immutable image identity is invalid."
    exit 1
  fi
done
scan_image \
  candidate_backend \
  "$candidate_backend_id" \
  "$RCP33G_PRIVATE_DIR/candidate-backend-scan.json"
scan_image \
  candidate_frontend \
  "$candidate_frontend_id" \
  "$RCP33G_PRIVATE_DIR/candidate-frontend-scan.json"
scan_image \
  rollback_backend \
  "$rollback_backend_id" \
  "$RCP33G_PRIVATE_DIR/rollback-backend-scan.json"
scan_image \
  rollback_frontend \
  "$rollback_frontend_id" \
  "$RCP33G_PRIVATE_DIR/rollback-frontend-scan.json"
export RCP33G_CANDIDATE_BACKEND_ID="$candidate_backend_id"
export RCP33G_CANDIDATE_FRONTEND_ID="$candidate_frontend_id"
export RCP33G_ROLLBACK_BACKEND_ID="$rollback_backend_id"
export RCP33G_ROLLBACK_FRONTEND_ID="$rollback_frontend_id"
python - <<'PY'
import json
import os
from pathlib import Path

summary = {
    "checks": {
        "candidate_backend": {
            "image_id": os.environ["RCP33G_CANDIDATE_BACKEND_ID"],
            "status": "passed",
        },
        "candidate_frontend": {
            "image_id": os.environ["RCP33G_CANDIDATE_FRONTEND_ID"],
            "status": "passed",
        },
        "rollback_backend": {
            "image_id": os.environ["RCP33G_ROLLBACK_BACKEND_ID"],
            "status": "passed",
        },
        "rollback_frontend": {
            "image_id": os.environ["RCP33G_ROLLBACK_FRONTEND_ID"],
            "status": "passed",
        },
        "source": {
            "archive_sha256": os.environ["RCP33G_SOURCE_ARCHIVE_SHA256"],
            "commit_sha": os.environ["GITHUB_SHA"],
            "status": "passed",
        },
    },
    "schema_version": 1,
    "tool": {
        "database_revision": os.environ["RCP33G_TRIVY_DATABASE_REVISION"],
        "name": "trivy",
        "version": os.environ["RCP33G_TRIVY_VERSION"],
    },
}
destination = Path(os.environ["RCP33G_PRIVATE_DIR"]) / "scanner-summary.json"
destination.write_text(
    json.dumps(summary, sort_keys=True, separators=(",", ":")) + "\n",
    encoding="utf-8",
)
destination.chmod(0o600)
PY
reload_environment

section 'Rehearse fresh, upgraded, and failed migrations'
(
  cd backend
  create_database() {
    docker run --rm --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      postgres:17-alpine \
      dropdb --host "$PGHOST" --username "$PGUSER" \
        --force --if-exists "$1" > /dev/null
    docker run --rm --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      postgres:17-alpine \
      createdb --host "$PGHOST" --username "$PGUSER" "$1"
  }
  catalog_counts() {
    docker run --rm --network host \
      -e PGPASSWORD="$PGPASSWORD" \
      postgres:17-alpine \
      psql --host "$PGHOST" --username "$PGUSER" --dbname "$1" \
        --tuples-only --no-align \
        --command "SELECT (SELECT count(*) FROM ingredients), (SELECT count(*) FROM measurement_units), (SELECT count(*) FROM cooking_action_types), (SELECT count(*) FROM recipe_versions);" \
      | tr -d '[:space:]'
  }
  fresh_url="postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_rcp33g_fresh"
  upgraded_url="postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_rcp32_acceptance"
  failure_url="postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_rcp33g_migration_failure"
  create_database recipe_lab_rcp33g_fresh
  DATABASE_URL="$fresh_url" python -m alembic upgrade head
  DATABASE_URL="$fresh_url" python -m alembic check

  DATABASE_URL="$upgraded_url" python -m alembic upgrade 20260827_0019
  DATABASE_URL="$upgraded_url" python -m app.seeds load
  upgraded_before="$(catalog_counts recipe_lab_rcp32_acceptance)"
  DATABASE_URL="$upgraded_url" python -m alembic upgrade head
  DATABASE_URL="$upgraded_url" python -m alembic check
  upgraded_after="$(catalog_counts recipe_lab_rcp32_acceptance)"
  test -n "$upgraded_before"
  test "$upgraded_before" = "$upgraded_after"

  create_database recipe_lab_rcp33g_migration_failure
  DATABASE_URL="$failure_url" python -m alembic upgrade 20260827_0019
  DATABASE_URL="$failure_url" python -m app.seeds load
  failure_before="$(catalog_counts recipe_lab_rcp33g_migration_failure)"
  docker run --rm --network host \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:17-alpine \
    psql --host "$PGHOST" --username "$PGUSER" \
      --dbname recipe_lab_rcp33g_migration_failure \
      --set ON_ERROR_STOP=1 \
      --command "ALTER TABLE recipe_drafts ADD COLUMN creation_action_id uuid;" \
    > /dev/null
  set +e
  DATABASE_URL="$failure_url" python -m alembic upgrade head \
    > "$RCP33G_PRIVATE_DIR/expected-migration-failure.log" 2>&1
  migration_result=$?
  set -e
  if [[ "$migration_result" == "0" ]]; then
    echo "The deliberately conflicted migration did not fail closed."
    exit 1
  fi
  current_revision="$(DATABASE_URL="$failure_url" python -m alembic current 2>/dev/null | awk '{print $1}')"
  test "$current_revision" = "20260827_0019"
  failure_after="$(catalog_counts recipe_lab_rcp33g_migration_failure)"
  test "$failure_before" = "$failure_after"
  docker run --rm --network host \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:17-alpine \
    psql --host "$PGHOST" --username "$PGUSER" \
      --dbname recipe_lab_rcp33g_migration_failure \
      --set ON_ERROR_STOP=1 \
      --command "ALTER TABLE recipe_drafts DROP COLUMN creation_action_id;" \
    > /dev/null
  DATABASE_URL="$failure_url" python -m alembic upgrade head
  DATABASE_URL="$failure_url" python -m alembic check
  end_revision="$(python -m alembic heads | awk 'NR == 1 {print $1}')"
  if [[ ! "$end_revision" =~ ^[0-9]{8}_[0-9]{4}$ \
    || "$end_revision" == "20260827_0019" ]]; then
    echo "The current migration head is invalid."
    exit 1
  fi
  printf '{"end_revision":"%s","phase":"migration","schema_version":1,"start_revision":"20260827_0019","status":"passed"}\n' \
    "$end_revision" \
    > "$RCP33G_PRIVATE_DIR/migration-summary.json"
)
reload_environment

section 'Start isolated identity and application services'
cd backend
python -m app.testing.community_release_gate stage-demo-activity \
  > "$RCP33G_PRIVATE_DIR/staged-demo-summary.json"
nohup python -m app.testing.local_oidc_provider \
  --host 127.0.0.1 \
  --port 8200 \
  > "$RCP33G_PRIVATE_DIR/oidc.log" 2>&1 &
echo $! > "$RCP33G_PRIVATE_DIR/oidc.pid"
nohup python -m uvicorn app.main:app \
  --host 127.0.0.1 \
  --port 8100 \
  --no-access-log \
  > "$RCP33G_PRIVATE_DIR/backend.log" 2>&1 &
echo $! > "$RCP33G_PRIVATE_DIR/backend.pid"
cd ../frontend
npm run build > "$RCP33G_PRIVATE_DIR/frontend-build.log" 2>&1
services_ready=0
for _ in {1..60}; do
  if curl --fail --silent http://127.0.0.1:8200/health > /dev/null \
    && curl --fail --silent http://127.0.0.1:8100/api/health > /dev/null; then
    services_ready=1
    break
  fi
  if ! kill -0 "$(cat "$RCP33G_PRIVATE_DIR/oidc.pid")" 2>/dev/null \
    || ! kill -0 "$(cat "$RCP33G_PRIVATE_DIR/backend.pid")" 2>/dev/null; then
    echo "An isolated rehearsal service stopped before becoming ready."
    exit 1
  fi
  sleep 1
done
if [[ "$services_ready" != "1" ]]; then
  echo "The isolated rehearsal services did not become ready."
  exit 1
fi
reload_environment

section 'Capture an older backup before account deletion'
(
  cd frontend
  npm run test:e2e:release-gate \
    > "$RCP33G_PRIVATE_DIR/browser.log" 2>&1 &
  browser_pid=$!
  echo "$browser_pid" > "$RCP33G_PRIVATE_DIR/browser.pid"
  checkpoint_ready=0
  # Playwright allows 120 seconds for its web server and 420 seconds for the
  # guarded journey; keep this watcher outside both valid windows.
  for _ in {1..600}; do
    if [[ -f "$RCP33G_BACKUP_READY_PATH" ]]; then
      checkpoint_ready=1
      break
    fi
    if ! kill -0 "$browser_pid" 2>/dev/null; then
      echo "The community journey stopped before the backup checkpoint."
      exit 1
    fi
    sleep 1
  done
  if [[ "$checkpoint_ready" != "1" ]]; then
    echo "The community journey did not reach the backup checkpoint."
    exit 1
  fi
  docker run --rm --network host \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:17-alpine \
    pg_dump --host "$PGHOST" --username "$PGUSER" \
      --dbname recipe_lab_rcp32_acceptance \
      --format custom --no-owner --no-privileges \
    > "$RCP33G_BACKUP_PATH"
  test -s "$RCP33G_BACKUP_PATH"
  install -m 0600 /dev/null "$RCP33G_BACKUP_CONTINUE_PATH"
  set +e
  wait "$browser_pid"
  browser_result=$?
  set -e
  rm -f -- "$RCP33G_PRIVATE_DIR/browser.pid"
  if [[ "$browser_result" != "0" ]]; then
    echo "The community journey failed; private diagnostics were withheld."
    exit "$browser_result"
  fi
)
reload_environment

section 'Export independently bound deletion evidence'
(
  cd backend
  python -m app.testing.community_release_gate \
    verify --manifest "$RCP32_MANIFEST_PATH" \
    > "$RCP33G_PRIVATE_DIR/live-community-summary.json"
  required_covered_through="$(docker run --rm --network host \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:17-alpine \
    psql --host "$PGHOST" --username "$PGUSER" \
      --dbname recipe_lab_rcp32_acceptance \
      --tuples-only --no-align \
      --command "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');" \
    | tr -d '[:space:]')"
  python -m app.recovery export \
    --output "$RCP33G_LEDGER_PATH" \
    > "$RCP33G_PRIVATE_DIR/ledger-export-summary.json"
  ledger_sha256="$(sha256sum "$RCP33G_LEDGER_PATH" | cut -d ' ' -f 1)"
  stale_covered_through="$(docker run --rm --network host \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:17-alpine \
    psql --host "$PGHOST" --username "$PGUSER" \
      --dbname recipe_lab_rcp32_acceptance \
      --tuples-only --no-align \
      --command "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"');" \
    | tr -d '[:space:]')"
  timestamp_pattern='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$'
  if [[ ! "$ledger_sha256" =~ ^[0-9a-f]{64}$ \
    || ! "$required_covered_through" =~ $timestamp_pattern \
    || ! "$stale_covered_through" =~ $timestamp_pattern ]]; then
    echo "The independent deletion-evidence controls are invalid."
    exit 1
  fi
  {
    echo "RCP33G_LEDGER_SHA256=$ledger_sha256"
    echo "RCP33G_REQUIRED_COVERED_THROUGH=$required_covered_through"
    echo "RCP33G_STALE_COVERED_THROUGH=$stale_covered_through"
  } >> "$GITHUB_ENV"
)
reload_environment

section 'Restore older backup and require negative replay failures'
docker run --rm --network host \
  -e PGPASSWORD="$PGPASSWORD" \
  postgres:17-alpine \
  dropdb --host "$PGHOST" --username "$PGUSER" \
    --force --if-exists recipe_lab_rcp32_acceptance_restore \
  > /dev/null
docker run --rm --network host \
  -e PGPASSWORD="$PGPASSWORD" \
  postgres:17-alpine \
  createdb --host "$PGHOST" --username "$PGUSER" \
    recipe_lab_rcp32_acceptance_restore
docker run --rm --interactive --network host \
  -e PGPASSWORD="$PGPASSWORD" \
  postgres:17-alpine \
  pg_restore --host "$PGHOST" --username "$PGUSER" \
    --dbname recipe_lab_rcp32_acceptance_restore \
    --exit-on-error --no-owner --no-privileges \
  < "$RCP33G_BACKUP_PATH"
restore_url="postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_rcp32_acceptance_restore"
(
  cd backend
  DATABASE_URL="$restore_url" python -m alembic upgrade head
  DATABASE_URL="$restore_url" python -m alembic check
)
# Every command after this boundary must use the isolated restored copy. Keep the
# exact-database check on replay as a second, independent guard.
export DATABASE_URL="$restore_url"
export TEST_DATABASE_URL="$restore_url"
assert_bob_active() {
  bob_id="$(python -c 'import json,os; print(json.load(open(os.environ["RCP32_MANIFEST_PATH"], encoding="utf-8"))["bob_user_id"])')"
  if [[ ! "$bob_id" =~ ^[0-9a-f-]{36}$ ]]; then
    echo "The restored member identity is invalid."
    exit 1
  fi
  bob_status="$(docker run --rm --network host \
    -e PGPASSWORD="$PGPASSWORD" \
    postgres:17-alpine \
    psql --host "$PGHOST" --username "$PGUSER" \
      --dbname recipe_lab_rcp32_acceptance_restore \
      --tuples-only --no-align \
      --command "SELECT status FROM users WHERE id = '$bob_id';" \
    | tr -d '[:space:]')"
  test "$bob_status" = "active"
}
expect_replay_failure() {
  set +e
  DATABASE_URL="$restore_url" python -m app.recovery replay \
    --expected-database-name recipe_lab_rcp32_acceptance_restore \
    --confirm-isolated-restore \
    "$@" \
    > /dev/null 2> "$RCP33G_PRIVATE_DIR/expected-replay-failure.log"
  replay_result=$?
  set -e
  if [[ "$replay_result" == "0" ]]; then
    echo "Invalid deletion evidence did not fail closed."
    exit 1
  fi
  assert_bob_active
}
assert_bob_active
expect_replay_failure \
  --ledger "$RCP33G_PRIVATE_DIR/missing-ledger.json" \
  --expected-sha256 "$RCP33G_LEDGER_SHA256" \
  --required-covered-through "$RCP33G_REQUIRED_COVERED_THROUGH"
printf '{}\n' > "$RCP33G_PRIVATE_DIR/malformed-ledger.json"
malformed_sha256="$(sha256sum "$RCP33G_PRIVATE_DIR/malformed-ledger.json" | cut -d ' ' -f 1)"
expect_replay_failure \
  --ledger "$RCP33G_PRIVATE_DIR/malformed-ledger.json" \
  --expected-sha256 "$malformed_sha256" \
  --required-covered-through "$RCP33G_REQUIRED_COVERED_THROUGH"
cp -- "$RCP33G_LEDGER_PATH" "$RCP33G_PRIVATE_DIR/unreadable-ledger.json"
chmod 000 "$RCP33G_PRIVATE_DIR/unreadable-ledger.json"
expect_replay_failure \
  --ledger "$RCP33G_PRIVATE_DIR/unreadable-ledger.json" \
  --expected-sha256 "$RCP33G_LEDGER_SHA256" \
  --required-covered-through "$RCP33G_REQUIRED_COVERED_THROUGH"
chmod 0600 "$RCP33G_PRIVATE_DIR/unreadable-ledger.json"
expect_replay_failure \
  --ledger "$RCP33G_LEDGER_PATH" \
  --expected-sha256 "$RCP33G_LEDGER_SHA256" \
  --required-covered-through "$RCP33G_STALE_COVERED_THROUGH"
reload_environment

section 'Replay valid ledger before restored traffic'
(
  cd backend
  DATABASE_URL="$restore_url" python -m app.recovery replay \
    --ledger "$RCP33G_LEDGER_PATH" \
    --expected-sha256 "$RCP33G_LEDGER_SHA256" \
    --required-covered-through "$RCP33G_REQUIRED_COVERED_THROUGH" \
    --expected-database-name recipe_lab_rcp32_acceptance_restore \
    --confirm-isolated-restore \
    > "$RCP33G_PRIVATE_DIR/ledger-replay-summary.json"
  DATABASE_URL="$restore_url" python -m alembic check
  DATABASE_URL="$restore_url" python -m app.testing.community_release_gate \
    verify --manifest "$RCP32_MANIFEST_PATH" \
    > "$RCP33G_PRIVATE_DIR/restored-community-summary.json"
  cmp --silent \
    "$RCP33G_PRIVATE_DIR/live-community-summary.json" \
    "$RCP33G_PRIVATE_DIR/restored-community-summary.json"
  mv -- \
    "$RCP33G_PRIVATE_DIR/live-community-summary.json" \
    "$RCP33G_SAFE_DIR/live-database-summary.json"
  mv -- \
    "$RCP33G_PRIVATE_DIR/restored-community-summary.json" \
    "$RCP33G_SAFE_DIR/restored-database-summary.json"
  printf '{"phase":"recovery","schema_version":1,"status":"passed"}\n' \
    > "$RCP33G_PRIVATE_DIR/recovery-summary.json"
  printf '{"phase":"community_journey","schema_version":1,"status":"passed"}\n' \
    > "$RCP33G_PRIVATE_DIR/community-journey-summary.json"
)
reload_environment

section 'Stop host harness before image smoke'
set +e
for pid_file in \
  "$RCP33G_PRIVATE_DIR/backend.pid" \
  "$RCP33G_PRIVATE_DIR/oidc.pid"; do
  if [[ -f "$pid_file" ]]; then
    pid="$(cat "$pid_file")"
    if [[ "$pid" =~ ^[0-9]+$ ]]; then
      kill "$pid" 2>/dev/null || true
      rm -f -- "$pid_file"
    fi
  fi
done
set -e
reload_environment

section 'Smoke exact candidate images after recovery'
docker run --detach --name recipe-lab-rcp33g-candidate-backend \
  --network host \
  -e PORT=8300 \
  -e DATABASE_URL=postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/recipe_lab_rcp32_acceptance_restore \
  -e CORS_ORIGINS=http://127.0.0.1:3300 \
  -e AUTH_ALLOWED_ORIGINS=http://127.0.0.1:3300 \
  -e OIDC_ISSUER=http://127.0.0.1:8200 \
  -e OIDC_CLIENT_ID=recipe-lab-rcp32 \
  -e OIDC_REDIRECT_URI=http://127.0.0.1:3300/api/auth/callback \
  -e OIDC_SCOPES='openid email profile' \
  -e OIDC_ALLOWED_SIGNING_ALGORITHMS=RS256 \
  -e ABUSE_RATE_LIMIT_SECRET="$ABUSE_RATE_LIMIT_SECRET" \
  -e INTERNAL_NETWORK_SIGNAL_SECRET="$INTERNAL_NETWORK_SIGNAL_SECRET" \
  "$candidate_backend_id" > /dev/null
docker run --detach --name recipe-lab-rcp33g-candidate-frontend \
  --network host \
  -e PORT=3300 \
  -e RECIPE_API_URL=http://127.0.0.1:8300 \
  -e INTERNAL_NETWORK_SIGNAL_SECRET="$INTERNAL_NETWORK_SIGNAL_SECRET" \
  "$candidate_frontend_id" > /dev/null
for attempt in {1..60}; do
  if curl --fail --silent http://127.0.0.1:8300/api/readiness > /dev/null \
    && curl --fail --silent http://127.0.0.1:3300/healthz > /dev/null; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "The exact candidate images did not become ready."
    exit 1
  fi
  sleep 1
done
public_recipe_id="$(python -c 'import json,os; print(json.load(open(os.environ["RCP32_MANIFEST_PATH"], encoding="utf-8"))["child_recipe_version_id"])')"
if [[ ! "$public_recipe_id" =~ ^[0-9a-f-]{36}$ ]]; then
  echo "The public smoke-test recipe identity is invalid."
  exit 1
fi
curl --fail --silent --output /dev/null \
  "http://127.0.0.1:8300/api/recipes/$public_recipe_id"
curl --fail --silent --output /dev/null \
  "http://127.0.0.1:3300/recipes/$public_recipe_id"
python - <<'PY'
import json
import urllib.request
from uuid import UUID

correlation_ids = set()
for url, expected in (
    ("http://127.0.0.1:8300/api/health", {"service": "recipe-lab-api", "status": "ok"}),
    ("http://127.0.0.1:8300/api/readiness", {"service": "recipe-lab-api", "status": "ready"}),
):
    with urllib.request.urlopen(url, timeout=5) as response:
        assert response.status == 200
        assert json.load(response) == expected
        value = response.headers["X-Correlation-ID"]
        parsed = UUID(value)
        assert parsed.version == 4 and str(parsed) == value
        assert value not in correlation_ids
        correlation_ids.add(value)
with urllib.request.urlopen("http://127.0.0.1:3300/healthz", timeout=5) as response:
    assert response.status == 200 and response.read() == b"ok\n"
PY
printf '{"phase":"smoke","schema_version":1,"status":"passed"}\n' \
  > "$RCP33G_PRIVATE_DIR/smoke-summary.json"
reload_environment

section 'Rehearse compatible image rollback without database downgrade'
(
  cd backend
  revision_before_rollback="$(DATABASE_URL="$restore_url" python -m alembic current 2>/dev/null | awk '{print $1}')"
  if [[ ! "$revision_before_rollback" =~ ^[0-9]{8}_[0-9]{4}$ ]]; then
    echo "The restored database revision is invalid."
    exit 1
  fi
  docker rm --force \
    recipe-lab-rcp33g-candidate-frontend \
    recipe-lab-rcp33g-candidate-backend \
    > /dev/null
  docker run --detach --name recipe-lab-rcp33g-rollback-backend \
    --network host \
    -e PORT=8300 \
    -e DATABASE_URL="$restore_url" \
    -e CORS_ORIGINS=http://127.0.0.1:3300 \
    -e AUTH_ALLOWED_ORIGINS=http://127.0.0.1:3300 \
    -e OIDC_ISSUER=http://127.0.0.1:8200 \
    -e OIDC_CLIENT_ID=recipe-lab-rcp32 \
    -e OIDC_REDIRECT_URI=http://127.0.0.1:3300/api/auth/callback \
    -e OIDC_SCOPES='openid email profile' \
    -e OIDC_ALLOWED_SIGNING_ALGORITHMS=RS256 \
    -e ABUSE_RATE_LIMIT_SECRET="$ABUSE_RATE_LIMIT_SECRET" \
    -e INTERNAL_NETWORK_SIGNAL_SECRET="$INTERNAL_NETWORK_SIGNAL_SECRET" \
    "$rollback_backend_id" > /dev/null
  docker run --detach --name recipe-lab-rcp33g-rollback-frontend \
    --network host \
    -e PORT=3300 \
    -e RECIPE_API_URL=http://127.0.0.1:8300 \
    -e INTERNAL_NETWORK_SIGNAL_SECRET="$INTERNAL_NETWORK_SIGNAL_SECRET" \
    "$rollback_frontend_id" > /dev/null
  for attempt in {1..60}; do
    if curl --fail --silent http://127.0.0.1:8300/api/readiness > /dev/null \
      && curl --fail --silent http://127.0.0.1:3300/healthz > /dev/null; then
      break
    fi
    if [[ "$attempt" == "60" ]]; then
      echo "The exact rollback images did not become ready."
      exit 1
    fi
    sleep 1
  done
  public_recipe_id="$(python -c 'import json,os; print(json.load(open(os.environ["RCP32_MANIFEST_PATH"], encoding="utf-8"))["child_recipe_version_id"])')"
  if [[ ! "$public_recipe_id" =~ ^[0-9a-f-]{36}$ ]]; then
    echo "The public rollback smoke-test recipe identity is invalid."
    exit 1
  fi
  curl --fail --silent --output /dev/null \
    "http://127.0.0.1:8300/api/recipes/$public_recipe_id"
  curl --fail --silent --output /dev/null \
    "http://127.0.0.1:3300/recipes/$public_recipe_id"
  DATABASE_URL="$restore_url" python -m alembic check
  revision_after_rollback="$(DATABASE_URL="$restore_url" python -m alembic current 2>/dev/null | awk '{print $1}')"
  if [[ "$revision_after_rollback" != "$revision_before_rollback" ]]; then
    echo "The image rollback changed the database revision."
    exit 1
  fi
  printf '{"phase":"rollback","schema_version":1,"status":"passed"}\n' \
    > "$RCP33G_PRIVATE_DIR/rollback-summary.json"
)
reload_environment

section 'Compile bounded privacy-safe release evidence'
python scripts/rehearse_release.py \
  --commit-sha "$GITHUB_SHA" \
  --rollback-commit-sha "$RCP33G_ROLLBACK_SHA" \
  --source-archive-sha256 "$RCP33G_SOURCE_ARCHIVE_SHA256" \
  --source-manifest "$RCP33G_SOURCE_MANIFEST" \
  --image-report "$RCP33G_PRIVATE_DIR/candidate-images.json" \
  --rollback-image-report "$RCP33G_PRIVATE_DIR/rollback-images.json" \
  --scanner-summary "$RCP33G_PRIVATE_DIR/scanner-summary.json" \
  --migration-summary "$RCP33G_PRIVATE_DIR/migration-summary.json" \
  --smoke-summary "$RCP33G_PRIVATE_DIR/smoke-summary.json" \
  --recovery-summary "$RCP33G_PRIVATE_DIR/recovery-summary.json" \
  --rollback-summary "$RCP33G_PRIVATE_DIR/rollback-summary.json" \
  --community-journey-summary "$RCP33G_PRIVATE_DIR/community-journey-summary.json" \
  --output "$RCP33G_SAFE_DIR/release-evidence.json"
cd backend
python -m app.testing.community_release_gate \
  scan-artifacts "$RCP33G_SAFE_DIR" \
  > "$RCP33G_PRIVATE_DIR/privacy-summary.json"
mv -- \
  "$RCP33G_PRIVATE_DIR/privacy-summary.json" \
  "$RCP33G_SAFE_DIR/privacy-summary.json"
reload_environment

CURRENT_PHASE="complete"
