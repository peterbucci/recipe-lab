from __future__ import annotations

from pathlib import Path

REPOSITORY = Path(__file__).parents[2]
WORKFLOW = REPOSITORY / ".github" / "workflows" / "publish-portfolio-sandbox.yml"
UNIT = REPOSITORY / "deploy" / "systemd" / "recipe-lab-portfolio-sandbox.service"
ENVIRONMENT = REPOSITORY / "deploy" / "systemd" / "sandbox.env.example"
RUNBOOK = REPOSITORY / "docs" / "portfolio-sandbox-deployment.md"
REHEARSAL_WORKFLOW = REPOSITORY / ".github" / "workflows" / "release-rehearsal.yml"


def test_release_workflow_is_manual_least_privilege_and_exact_commit_gated() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert "workflow_dispatch:" in workflow
    assert "pull_request:" not in workflow
    assert "push:" not in workflow
    assert "permissions: {}" in workflow
    assert "actions: read" in workflow
    assert "contents: read" in workflow
    assert "packages: write" in workflow
    assert "expected_commit must be a full lowercase commit SHA" in workflow
    assert 'require_success("ci.yml")' in workflow
    assert 'require_success("release-rehearsal.yml")' in workflow
    assert "git merge-base --is-ancestor" in workflow


def test_release_workflow_verifies_the_registry_digests_and_resumes_safely() -> None:
    workflow = WORKFLOW.read_text(encoding="utf-8")

    assert 'tag="sha-${SOURCE_COMMIT}"' in workflow
    assert "publish_or_resume" in workflow
    assert "already identifies different image content" in workflow
    assert 'docker pull "$backend_reference"' in workflow
    assert 'docker pull "$frontend_reference"' in workflow
    assert '"$reference"; then' in workflow
    assert '"published_digest_pull": "passed"' in workflow
    assert '"published_digest_scan": "passed"' in workflow
    assert "Deploy only these digest-qualified references" in workflow


def test_release_rehearsal_tracks_every_portfolio_supervisor_boundary() -> None:
    workflow = REHEARSAL_WORKFLOW.read_text(encoding="utf-8")

    for path in (
        "scripts/rehearse_portfolio_sandbox.py",
        "scripts/run_portfolio_sandbox.py",
        "scripts/tests/test_rehearse_portfolio_sandbox.py",
        "scripts/tests/test_run_portfolio_sandbox.py",
    ):
        assert workflow.count(f"- {path}") == 2


def test_host_service_preserves_the_fail_stop_and_proxy_boundaries() -> None:
    unit = UNIT.read_text(encoding="utf-8")
    environment = ENVIRONMENT.read_text(encoding="utf-8")

    assert "RestartPreventExitStatus=78" in unit
    assert "LimitCORE=0" in unit
    assert "MemoryMax=256M" in unit
    assert "MemorySwapMax=0" in unit
    assert "TasksMax=64" in unit
    assert "--heartbeat-directory /run/recipe-lab-sandbox" in unit
    assert "--state-directory /var/lib/recipe-lab-sandbox" in unit
    assert "--trusted-proxy-cidrs ${RECIPE_LAB_TRUSTED_PROXY_CIDRS}" in unit
    assert "--listen-host ${RECIPE_LAB_LISTEN_HOST}" in unit
    assert "0.0.0.0" not in unit
    assert "TRUSTED_PROXY_PROOF_SECRET=<64-lowercase-hex-characters-generated-on-host>" in (
        environment
    )


def test_runbook_keeps_readiness_proof_and_public_routing_fail_closed() -> None:
    runbook = RUNBOOK.read_text(encoding="utf-8")

    assert "path: /readyz" in runbook
    assert "timeout: 7s" in runbook
    assert "X-Recipe-Lab-Proxy-Proof" in runbook
    assert "TRUSTED_PROXY_PROOF_SECRET" in runbook
    assert "accessLogs: false" in runbook
    assert "recipe-lab-sandbox-https-redirect" in runbook
    assert "Keep `recipe-lab-sandbox-proxy-proof`" in runbook
    assert "Keep `supervisor.lock`" in runbook
    assert "Do not use `docker system prune`" in runbook


def test_runbook_maps_classic_and_containerd_runtime_image_identities() -> None:
    runbook = RUNBOOK.read_text(encoding="utf-8")

    assert "resolve_runtime_id" in runbook
    assert "Docker 29's containerd image store" in runbook
    assert "docker buildx imagetools inspect --raw" in runbook
    assert 'json.load(sys.stdin)["config"]["digest"]' in runbook
    assert '"$manifest_config_id" = "$expected_config_id"' in runbook
    assert 'docker image inspect --format \'{{.Id}}\' "$runtime_id"' in runbook
