import json
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, delete, text, update
from sqlalchemy.exc import StatementError
from sqlalchemy.orm import Session

import app.testing.community_release_gate as community_release_gate
from app.core.demo_identity import DEMO_USER_ID
from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    USER_STATUS_DELETED,
    CommunityModerator,
    Ingredient,
    IngredientCatalogRequest,
    OIDCIdentity,
    PreferenceEvent,
    RecipeDraft,
    RecipeDuplicateCandidate,
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
    RecipeIngredient,
    RecipeLineage,
    RecipeModerationAuditEvent,
    RecipeModerationCase,
    RecipeRating,
    RecipeReport,
    RecipeSave,
    RecipeVersion,
    RecipeVersionPublication,
    User,
)
from app.repositories.account_lifecycle import DELETED_REPORT_FINGERPRINT
from app.seeds import load_bundled_catalog
from app.seeds.identifiers import seed_uuid
from app.testing.community_release_gate import (
    ACCEPTANCE_DATABASE_NAMES,
    DEMO_ACTIVITY_RATING,
    DEMO_ACTIVITY_RECIPE_KEY,
    DEMO_ACTIVITY_VIEW_ACTION_ID,
    DEMO_ACTIVITY_VIEW_EVENT_ID,
    PRIMARY_ACCEPTANCE_DATABASE_NAMES,
    CommunityReleaseGateError,
    CommunityReleaseManifest,
    ReleaseGateSummary,
    _create_release_gate_engine,
    load_manifest,
    main,
    parse_manifest,
    render_summary,
    scan_artifacts,
    stage_demo_activity,
    validate_release_gate_environment,
    validate_stage_demo_environment,
    verify_release_gate,
)

MANIFEST_VALUES: dict[str, object] = {
    "version": 1,
    "alice_user_id": "32000000-0000-4000-8000-000000000001",
    "bob_user_id": "32000000-0000-4000-8000-000000000002",
    "curator_user_id": "32000000-0000-4000-8000-000000000003",
    "moderator_user_id": "32000000-0000-4000-8000-000000000004",
    "root_recipe_version_id": "32000000-0000-4000-8000-000000000101",
    "child_recipe_version_id": "32000000-0000-4000-8000-000000000102",
    "ingredient_request_id": "32000000-0000-4000-8000-000000000201",
    "approved_ingredient_id": "32000000-0000-4000-8000-000000000202",
    "exact_preflight_id": "32000000-0000-4000-8000-000000000301",
    "probable_preflight_id": "32000000-0000-4000-8000-000000000302",
    "report_id": "32000000-0000-4000-8000-000000000401",
}


def _manifest() -> CommunityReleaseManifest:
    return parse_manifest(MANIFEST_VALUES)


def _guarded_environment(database_name: str) -> dict[str, str]:
    return {
        "RCP32_ACCEPTANCE": "1",
        "ACCEPTANCE_DATABASE_ISOLATED": "1",
        "DATABASE_URL": (
            f"postgresql+psycopg://recipe_lab:recipe_lab@127.0.0.1:5432/{database_name}"
        ),
    }


def test_manifest_parser_requires_exact_keys_version_and_canonical_uuids(tmp_path: Path) -> None:
    parsed = parse_manifest(MANIFEST_VALUES)

    assert parsed.version == 1
    assert parsed.alice_user_id == UUID(str(MANIFEST_VALUES["alice_user_id"]))

    for changed in (
        {key: value for key, value in MANIFEST_VALUES.items() if key != "report_id"},
        {**MANIFEST_VALUES, "unexpected": "value"},
        {**MANIFEST_VALUES, "version": True},
        {**MANIFEST_VALUES, "alice_user_id": "not-a-uuid"},
        {
            **MANIFEST_VALUES,
            "alice_user_id": "AAAAAAAA-0000-4000-8000-000000000001",
        },
    ):
        with pytest.raises(CommunityReleaseGateError):
            parse_manifest(changed)

    duplicate_manifest = tmp_path / "duplicate.json"
    duplicate_manifest.write_text(
        json.dumps(MANIFEST_VALUES)[:-1] + ',"version":1}',
        encoding="utf-8",
    )
    with pytest.raises(CommunityReleaseGateError, match="duplicate keys"):
        load_manifest(duplicate_manifest)


@pytest.mark.parametrize("database_name", sorted(ACCEPTANCE_DATABASE_NAMES))
def test_database_guard_accepts_only_explicit_disposable_names(database_name: str) -> None:
    environment = _guarded_environment(database_name)

    assert validate_release_gate_environment(environment) == environment["DATABASE_URL"]


@pytest.mark.parametrize("database_name", sorted(PRIMARY_ACCEPTANCE_DATABASE_NAMES))
def test_demo_activity_guard_accepts_only_primary_disposable_names(database_name: str) -> None:
    environment = _guarded_environment(database_name)

    assert validate_stage_demo_environment(environment) == environment["DATABASE_URL"]


@pytest.mark.parametrize(
    "database_name",
    [
        "recipe_lab_rcp32_acceptance_restore",
        "recipe_lab_rcp32_acceptance_local_restore",
        "recipe_lab_rcp32_acceptance_copy",
    ],
)
def test_demo_activity_guard_refuses_restore_and_near_match_names(database_name: str) -> None:
    with pytest.raises(CommunityReleaseGateError):
        validate_stage_demo_environment(_guarded_environment(database_name))


@pytest.mark.parametrize(
    "environment",
    [
        {},
        {
            "RCP32_ACCEPTANCE": "1",
            "DATABASE_URL": "postgresql+psycopg://localhost/recipe_lab_rcp32_acceptance",
        },
        {
            "RCP32_ACCEPTANCE": "1",
            "ACCEPTANCE_DATABASE_ISOLATED": "1",
            "DATABASE_URL": "sqlite:///recipe_lab_rcp32_acceptance.db",
        },
        _guarded_environment("recipe_lab_rcp32_acceptance_backup"),
        _guarded_environment("recipe_lab_rcp32_acceptance_local_restore_copy"),
        _guarded_environment("recipe_lab"),
    ],
)
def test_database_guard_refuses_missing_flags_non_postgres_and_near_matches(
    environment: dict[str, str],
) -> None:
    with pytest.raises(CommunityReleaseGateError):
        validate_release_gate_environment(environment)


def test_artifact_scanner_allows_opaque_manifest_and_count_only_summary(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(MANIFEST_VALUES), encoding="utf-8")
    summary_path = tmp_path / "summary.json"
    summary_path.write_text(
        '{"checks":[{"count":2,"name":"root_child_lineage_versions"}],"version":1}',
        encoding="utf-8",
    )

    summary = scan_artifacts([tmp_path])
    rendered = render_summary(summary)

    assert summary["checks"] == [
        {"name": "artifact_files_scanned", "count": 2},
        {"name": "artifact_privacy_findings", "count": 0},
    ]
    assert "32000000-0000-4000-8000-000000000001" not in rendered


@pytest.mark.parametrize(
    "private_value",
    [
        "alice@rcp32.recipe-lab.invalid",
        "bob@rcp32.recipe-lab.invalid",
        "curator@rcp32.recipe-lab.invalid",
        "moderator@rcp32.recipe-lab.invalid",
        "RCP32-ALICE",
        "RCP32-BOB",
        "RCP32-CURATOR",
        "RCP32-MODERATOR",
        "RCP32_PRIVATE_REPORT_CANARY",
        "RCP32_PRIVATE_MODERATOR_NOTE_CANARY",
        "RCP32_PRIVATE_REQUEST_CONTEXT_CANARY",
        "RCP32_PRIVATE_CURATOR_DECISION_REASON_CANARY",
        "RCP32_PRIVATE_CURATOR_PROVENANCE_CANARY",
        "Cookie: recipe_lab_session=secret",
        "RECIPE_LAB_CSRF=secret",
        "recipe_lab_login=secret",
        "X-CSRF-Token: secret",
        '{"name":"X-CSRF-Token","value":"secret"}',
        "Authorization: Bearer secret",
        '{"name":"authorization","value":"Bearer secret"}',
        "https://app.invalid/callback?code=secret&state=secret",
        "https://app.invalid/callback?ok=1&code=secret",
    ],
)
def test_artifact_scanner_rejects_private_values_without_echoing_them(
    tmp_path: Path,
    private_value: str,
) -> None:
    artifact = tmp_path / "artifact.txt"
    artifact.write_text(private_value, encoding="utf-8")

    with pytest.raises(CommunityReleaseGateError) as captured:
        scan_artifacts([artifact])

    assert private_value.casefold() not in str(captured.value).casefold()
    assert "1 file(s)" in str(captured.value)


def test_artifact_scanner_inspects_compressed_trace_members(tmp_path: Path) -> None:
    trace = tmp_path / "trace.zip"
    with zipfile.ZipFile(trace, "w") as archive:
        archive.writestr("trace/network.log", "request /callback?state=private")

    with pytest.raises(CommunityReleaseGateError, match=r"1 file\(s\)"):
        scan_artifacts([trace])


def test_release_gate_engine_hides_statement_parameters() -> None:
    engine = _create_release_gate_engine("sqlite+pysqlite:///:memory:")
    try:
        assert engine.hide_parameters is True
    finally:
        engine.dispose()


def test_cli_suppresses_private_database_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private_sentinel = "PRIVATE-MANIFEST-UUID-SENTINEL"
    database_error = StatementError(
        "database request failed",
        "SELECT * FROM private_table WHERE user_id = :user_id",
        {"user_id": private_sentinel},
        RuntimeError(private_sentinel),
        hide_parameters=False,
    )
    assert private_sentinel in str(database_error)

    def fail_verification(_manifest_path: Path) -> None:
        raise database_error

    monkeypatch.setattr(
        community_release_gate,
        "_verify_command",
        fail_verification,
    )
    with pytest.raises(SystemExit) as captured:
        main(["verify", "--manifest", "private-manifest.json"])

    assert "private database diagnostics were withheld" in str(captured.value)
    assert private_sentinel not in str(captured.value)
    assert captured.value.__cause__ is None


def test_stage_demo_activity_subcommand_dispatches_without_a_manifest(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    expected: ReleaseGateSummary = {
        "version": 1,
        "checks": [{"name": "demo_activity_rows_staged", "count": 3}],
    }
    monkeypatch.setattr(
        community_release_gate,
        "_stage_demo_activity_command",
        lambda: expected,
    )

    assert main(["stage-demo-activity"]) == 0
    assert capsys.readouterr().out == render_summary(expected) + "\n"


def _stage_release_gate(session: Session) -> CommunityReleaseManifest:
    manifest = _manifest()
    now = datetime(2026, 8, 26, 18, 0, tzinfo=UTC)
    exact_recipe_version_id = UUID("32000000-0000-4000-8000-000000000103")
    stage_demo_activity(session)
    alice = User(
        id=manifest.alice_user_id,
        email="alice@rcp32.recipe-lab.invalid",
        display_name="Alice",
        handle="rcp32-alice",
        account_kind=ACCOUNT_KIND_MEMBER,
        status=USER_STATUS_ACTIVE,
    )
    bob = User(
        id=manifest.bob_user_id,
        email=None,
        display_name="Deleted cook",
        handle=None,
        account_kind=ACCOUNT_KIND_MEMBER,
        status=USER_STATUS_DELETED,
        deleted_at=now,
    )
    curator = User(
        id=manifest.curator_user_id,
        email="curator@rcp32.recipe-lab.invalid",
        display_name="Curator",
        handle="rcp32-curator",
        account_kind=ACCOUNT_KIND_MEMBER,
        status=USER_STATUS_ACTIVE,
    )
    moderator = User(
        id=manifest.moderator_user_id,
        email="moderator@rcp32.recipe-lab.invalid",
        display_name="Moderator",
        handle="rcp32-moderator",
        account_kind=ACCOUNT_KIND_MEMBER,
        status=USER_STATUS_ACTIVE,
    )
    session.add_all([alice, bob, curator, moderator])
    session.flush()
    session.add_all(
        [
            OIDCIdentity(
                user_id=alice.id,
                issuer="https://issuer.rcp32.invalid",
                subject="rcp32-alice",
                email="alice@rcp32.recipe-lab.invalid",
                email_verified=True,
            ),
        ]
    )

    lineage = RecipeLineage(created_by_user_id=alice.id)
    session.add(lineage)
    session.flush()
    root = RecipeVersion(
        id=manifest.root_recipe_version_id,
        lineage_id=lineage.id,
        parent_version_id=None,
        created_by_user_id=alice.id,
        version_number=1,
        title="Acceptance root",
        servings=Decimal("4.00"),
    )
    exact_version = RecipeVersion(
        id=exact_recipe_version_id,
        lineage_id=lineage.id,
        parent_version_id=root.id,
        created_by_user_id=bob.id,
        version_number=2,
        title="Acceptance exact fork",
        servings=Decimal("4.00"),
    )
    child = RecipeVersion(
        id=manifest.child_recipe_version_id,
        lineage_id=lineage.id,
        parent_version_id=root.id,
        created_by_user_id=bob.id,
        version_number=3,
        title="Acceptance child",
        servings=Decimal("4.00"),
    )
    session.add_all([root, exact_version, child])
    session.flush()

    ingredient = Ingredient(
        id=manifest.approved_ingredient_id,
        canonical_name="RCP32 acceptance herb",
    )
    request = IngredientCatalogRequest(
        id=manifest.ingredient_request_id,
        requester_user_id=alice.id,
        proposed_name="Acceptance herb",
        normalized_name="acceptance herb",
        normalized_name_digest="1" * 64,
        status="approved",
        reviewer_user_id=curator.id,
        reviewed_at=now,
        decision_reason="Accepted for release proof.",
        resolved_ingredient_id=ingredient.id,
        approved_canonical_name=ingredient.canonical_name,
        approved_aliases=[],
        approval_provenance="RCP-32 acceptance evidence.",
    )
    session.add_all([ingredient, request])
    session.flush()
    session.add(
        RecipeIngredient(
            recipe_version_id=root.id,
            ingredient_id=ingredient.id,
            name=ingredient.canonical_name,
            measure_mode="unspecified",
            quantity_min=None,
            quantity_max=None,
            measurement_unit_id=None,
            unit_display=None,
            package_size_id=None,
            display_order=0,
        )
    )

    distinct = RecipeDuplicatePreflight(
        actor_user_id=alice.id,
        action_id=uuid4(),
        request_fingerprint="b" * 64,
        source_version_id=None,
        subject_fingerprint_algorithm="rcp32.v1",
        subject_fingerprint_digest="c" * 64,
        policy_version="rcp32.v1",
        classification="distinct",
        same_parent_no_change=False,
        result_digest="d" * 64,
    )
    probable = RecipeDuplicatePreflight(
        id=manifest.probable_preflight_id,
        actor_user_id=bob.id,
        action_id=uuid4(),
        request_fingerprint="2" * 64,
        source_version_id=root.id,
        subject_fingerprint_algorithm="rcp32.v1",
        subject_fingerprint_digest="3" * 64,
        policy_version="rcp32.v1",
        classification="probable_duplicate",
        same_parent_no_change=False,
        result_digest="4" * 64,
    )
    exact = RecipeDuplicatePreflight(
        id=manifest.exact_preflight_id,
        actor_user_id=bob.id,
        action_id=uuid4(),
        request_fingerprint="5" * 64,
        source_version_id=root.id,
        subject_fingerprint_algorithm="rcp32.v1",
        subject_fingerprint_digest="6" * 64,
        policy_version="rcp32.v1",
        classification="exact_duplicate",
        same_parent_no_change=True,
        result_digest="7" * 64,
    )
    session.add_all([distinct, probable, exact])
    session.flush()
    session.add(
        RecipeDuplicateCandidate(
            preflight_id=probable.id,
            # Once the unchanged sibling exists, it can correctly outrank the
            # root while remaining part of the same direct lineage.
            public_recipe_version_id=exact_version.id,
            rank=1,
            classification="probable_duplicate",
            score_basis_points=8_500,
            reason_codes=[
                "overlapping_ingredient_multisets",
                "partially_matching_quantities",
                "different_action_order",
            ],
            fingerprint_algorithm_version=probable.subject_fingerprint_algorithm,
            policy_version=probable.policy_version,
            exact_payload_confirmed=False,
        )
    )
    probable_decision = RecipeDuplicateDecision(
        preflight_id=probable.id,
        actor_user_id=bob.id,
        action_id=uuid4(),
        decision="continue",
        acknowledged_policy_version=probable.policy_version,
        acknowledged_result_digest=probable.result_digest,
    )
    exact_decision = RecipeDuplicateDecision(
        preflight_id=exact.id,
        actor_user_id=bob.id,
        action_id=uuid4(),
        decision="continue",
        acknowledged_policy_version=exact.policy_version,
        acknowledged_result_digest=exact.result_digest,
    )
    session.add_all([probable_decision, exact_decision])
    session.flush()

    root_draft = RecipeDraft(
        author_user_id=alice.id,
        status="published",
        revision=1,
        title="Acceptance root workspace",
        servings=Decimal("4.00"),
    )
    exact_draft = RecipeDraft(
        author_user_id=bob.id,
        source_version_id=root.id,
        status="published",
        revision=1,
        title="",
        description=None,
        servings=None,
    )
    child_draft = RecipeDraft(
        author_user_id=bob.id,
        source_version_id=root.id,
        status="published",
        revision=1,
        title="",
        description=None,
        servings=None,
    )
    session.add_all([root_draft, exact_draft, child_draft])
    session.flush()
    session.add_all(
        [
            RecipeVersionPublication(
                recipe_version_id=root.id,
                state="author_withdrawn",
                author_withdrawn_at=now,
                state_changed_at=now,
                state_changed_by_user_id=alice.id,
                source_draft_id=root_draft.id,
                actor_user_id=alice.id,
                action_id=uuid4(),
                request_fingerprint="8" * 64,
                draft_revision=root_draft.revision,
                duplicate_preflight_id=distinct.id,
                duplicate_policy_version=distinct.policy_version,
                duplicate_result_digest=distinct.result_digest,
                duplicate_decision_id=None,
                community_rules_version="community-rules-v1",
                publication_rights_confirmed_at=now,
                published_at=now,
            ),
            RecipeVersionPublication(
                recipe_version_id=exact_version.id,
                state="published",
                state_changed_at=now,
                state_changed_by_user_id=bob.id,
                source_draft_id=exact_draft.id,
                actor_user_id=bob.id,
                action_id=uuid4(),
                request_fingerprint="9" * 64,
                draft_revision=exact_draft.revision,
                duplicate_preflight_id=exact.id,
                duplicate_policy_version=exact.policy_version,
                duplicate_result_digest=exact.result_digest,
                duplicate_decision_id=exact_decision.id,
                community_rules_version="community-rules-v1",
                publication_rights_confirmed_at=now,
                published_at=now,
            ),
            RecipeVersionPublication(
                recipe_version_id=child.id,
                state="published",
                state_changed_at=now,
                state_changed_by_user_id=bob.id,
                source_draft_id=child_draft.id,
                actor_user_id=bob.id,
                action_id=uuid4(),
                request_fingerprint="e" * 64,
                draft_revision=child_draft.revision,
                duplicate_preflight_id=probable.id,
                duplicate_policy_version=probable.policy_version,
                duplicate_result_digest=probable.result_digest,
                duplicate_decision_id=probable_decision.id,
                community_rules_version="community-rules-v1",
                publication_rights_confirmed_at=now,
                published_at=now,
            ),
        ]
    )
    session.flush()

    moderation_case = RecipeModerationCase(
        recipe_version_id=root.id,
        status="resolved",
        opened_at=now,
        resolved_at=now,
        reporter_count=1,
        last_reported_at=now,
        updated_at=now,
    )
    session.add(moderation_case)
    session.flush()
    session.add_all(
        [
            RecipeReport(
                id=manifest.report_id,
                recipe_version_id=root.id,
                reporter_user_id=bob.id,
                reason="other",
                details=None,
                action_id=uuid4(),
                request_fingerprint=DELETED_REPORT_FINGERPRINT,
            ),
            RecipeModerationAuditEvent(
                recipe_version_id=root.id,
                actor_user_id=moderator.id,
                action="hide",
                previous_status="open",
                status="open",
                visibility_state="moderation_hidden",
                private_note="RCP32_PRIVATE_MODERATOR_NOTE_CANARY",
                action_id=uuid4(),
                request_fingerprint="a" * 64,
                occurred_at=now,
            ),
            RecipeModerationAuditEvent(
                recipe_version_id=root.id,
                actor_user_id=moderator.id,
                action="restore",
                previous_status="open",
                status="open",
                visibility_state="published",
                private_note=None,
                action_id=uuid4(),
                request_fingerprint="c" * 64,
                occurred_at=now,
            ),
            RecipeModerationAuditEvent(
                recipe_version_id=root.id,
                actor_user_id=moderator.id,
                action="resolve",
                previous_status="open",
                status="resolved",
                visibility_state="published",
                private_note=None,
                action_id=uuid4(),
                request_fingerprint="f" * 64,
                occurred_at=now,
            ),
        ]
    )
    session.flush()
    return manifest


@pytest.fixture
def release_gate_database(
    seeded_api_engine: Engine,
) -> Iterator[tuple[Session, CommunityReleaseManifest]]:
    with seeded_api_engine.connect() as connection:
        transaction = connection.begin()
        session = Session(bind=connection, expire_on_commit=False)
        try:
            yield session, _stage_release_gate(session)
        finally:
            session.close()
            if transaction.is_active:
                transaction.rollback()


def _demo_activity_recipe_version_id() -> UUID:
    catalog = load_bundled_catalog()
    assert any(recipe.key == DEMO_ACTIVITY_RECIPE_KEY for recipe in catalog.recipes)
    return seed_uuid(
        catalog.metadata.dataset_id,
        "recipe-version",
        DEMO_ACTIVITY_RECIPE_KEY,
    )


def test_demo_activity_staging_is_exact_and_idempotent(
    release_gate_database: tuple[Session, CommunityReleaseManifest],
) -> None:
    session, _ = release_gate_database
    recipe_version_id = _demo_activity_recipe_version_id()

    first = stage_demo_activity(session)
    second = stage_demo_activity(session)

    assert (
        first
        == second
        == {
            "version": 1,
            "checks": [{"name": "demo_activity_rows_staged", "count": 3}],
        }
    )
    assert (
        session.get(
            RecipeSave,
            {
                "user_id": DEMO_USER_ID,
                "recipe_version_id": recipe_version_id,
            },
        )
        is not None
    )
    rating = session.get(
        RecipeRating,
        {"user_id": DEMO_USER_ID, "recipe_version_id": recipe_version_id},
    )
    assert rating is not None
    assert rating.rating == DEMO_ACTIVITY_RATING
    view = session.get(PreferenceEvent, DEMO_ACTIVITY_VIEW_EVENT_ID)
    assert view is not None
    assert view.user_id == DEMO_USER_ID
    assert view.action_id == DEMO_ACTIVITY_VIEW_ACTION_ID
    assert view.recipe_version_id == recipe_version_id


def test_demo_activity_staging_rejects_conflicting_existing_state(
    release_gate_database: tuple[Session, CommunityReleaseManifest],
) -> None:
    session, _ = release_gate_database
    rating = session.get(
        RecipeRating,
        {
            "user_id": DEMO_USER_ID,
            "recipe_version_id": _demo_activity_recipe_version_id(),
        },
    )
    assert rating is not None
    rating.rating = DEMO_ACTIVITY_RATING + 1
    session.flush()

    with pytest.raises(CommunityReleaseGateError, match="demo_activity_conflict"):
        stage_demo_activity(session)


@pytest.mark.parametrize("interaction", ["save", "rating", "view"])
def test_database_verifier_rejects_demo_activity_reassignment(
    release_gate_database: tuple[Session, CommunityReleaseManifest],
    interaction: str,
) -> None:
    session, manifest = release_gate_database
    recipe_version_id = _demo_activity_recipe_version_id()
    if interaction == "save":
        session.execute(
            delete(RecipeSave).where(
                RecipeSave.user_id == DEMO_USER_ID,
                RecipeSave.recipe_version_id == recipe_version_id,
            )
        )
        session.add(
            RecipeSave(
                user_id=manifest.alice_user_id,
                recipe_version_id=recipe_version_id,
            )
        )
    elif interaction == "rating":
        session.execute(
            delete(RecipeRating).where(
                RecipeRating.user_id == DEMO_USER_ID,
                RecipeRating.recipe_version_id == recipe_version_id,
            )
        )
        session.add(
            RecipeRating(
                user_id=manifest.alice_user_id,
                recipe_version_id=recipe_version_id,
                rating=DEMO_ACTIVITY_RATING,
            )
        )
    else:
        view = session.get(PreferenceEvent, DEMO_ACTIVITY_VIEW_EVENT_ID)
        assert view is not None
        view.user_id = manifest.alice_user_id
    session.flush()

    with pytest.raises(CommunityReleaseGateError, match="staged_demo_activity"):
        verify_release_gate(session, manifest)


def test_database_verifier_proves_release_seams_with_privacy_safe_output(
    release_gate_database: tuple[Session, CommunityReleaseManifest],
) -> None:
    session, manifest = release_gate_database

    summary = verify_release_gate(session, manifest)
    rendered = render_summary(summary)

    assert [check["name"] for check in summary["checks"]] == [
        "release_member_lifecycle",
        "alice_oidc_identities",
        "bob_private_stores_erased",
        "bob_published_drafts_scrubbed",
        "root_child_lineage_versions",
        "final_publication_states",
        "approved_catalog_request_and_use",
        "revoked_separate_role_grants",
        "duplicate_preflight_classifications",
        "duplicate_continue_publication_bindings",
        "deleted_report_scrubbed",
        "moderation_audit_events",
        "non_login_accounts_without_oidc",
        "seeded_catalog_versions_and_lineages",
        "staged_demo_interactions_retained",
    ]
    manifest_identifiers = [
        str(value) for key, value in MANIFEST_VALUES.items() if key != "version"
    ]
    assert not any(identifier in rendered for identifier in manifest_identifiers)
    assert "RCP32_PRIVATE_MODERATOR_NOTE_CANARY" not in rendered


def test_database_verifier_requires_probable_candidate_evidence(
    release_gate_database: tuple[Session, CommunityReleaseManifest],
) -> None:
    session, manifest = release_gate_database
    session.execute(text("ALTER TABLE recipe_duplicate_candidates DISABLE TRIGGER USER"))
    try:
        session.execute(
            delete(RecipeDuplicateCandidate).where(
                RecipeDuplicateCandidate.preflight_id == manifest.probable_preflight_id
            )
        )
    finally:
        session.execute(text("ALTER TABLE recipe_duplicate_candidates ENABLE TRIGGER USER"))
    session.flush()

    with pytest.raises(CommunityReleaseGateError, match="duplicate_candidate_evidence"):
        verify_release_gate(session, manifest)


def test_database_verifier_rejects_reintroduced_deleted_member_identity_without_leak(
    release_gate_database: tuple[Session, CommunityReleaseManifest],
) -> None:
    session, manifest = release_gate_database
    private_email = "bob-reintroduced@rcp32.recipe-lab.invalid"
    session.add(
        OIDCIdentity(
            user_id=manifest.bob_user_id,
            issuer="https://issuer.rcp32.invalid",
            subject="reintroduced-private-subject",
            email=private_email,
            email_verified=True,
        )
    )
    session.flush()

    with pytest.raises(CommunityReleaseGateError) as captured:
        verify_release_gate(session, manifest)

    assert "bob_private_data_erased" in str(captured.value)
    assert private_email not in str(captured.value)


def test_database_verifier_rejects_reintroduced_moderator_grant(
    release_gate_database: tuple[Session, CommunityReleaseManifest],
) -> None:
    session, manifest = release_gate_database
    session.add(CommunityModerator(user_id=manifest.moderator_user_id))
    session.flush()

    with pytest.raises(
        CommunityReleaseGateError,
        match="moderator_grant_revoked_and_separate",
    ):
        verify_release_gate(session, manifest)


@pytest.mark.parametrize("wrong_owner_kind", ["member", "wrong_system"])
def test_database_verifier_rejects_seed_lineage_reassignment(
    release_gate_database: tuple[Session, CommunityReleaseManifest],
    wrong_owner_kind: str,
) -> None:
    session, manifest = release_gate_database
    if wrong_owner_kind == "member":
        wrong_owner_id = manifest.alice_user_id
    else:
        wrong_owner = User(
            email="wrong-system@recipe-lab.invalid",
            display_name="Wrong system owner",
            handle="wrong-system-owner",
            account_kind="system",
            status="active",
        )
        session.add(wrong_owner)
        session.flush()
        wrong_owner_id = wrong_owner.id

    catalog = load_bundled_catalog()
    seed_lineage_id = seed_uuid(
        catalog.metadata.dataset_id,
        "recipe-lineage",
        next(recipe.key for recipe in catalog.recipes if recipe.parent is None),
    )
    session.execute(text("ALTER TABLE recipe_lineages DISABLE TRIGGER USER"))
    try:
        session.execute(
            update(RecipeLineage)
            .where(RecipeLineage.id == seed_lineage_id)
            .values(created_by_user_id=wrong_owner_id)
        )
        session.flush()
    finally:
        session.execute(text("ALTER TABLE recipe_lineages ENABLE TRIGGER USER"))

    with pytest.raises(
        CommunityReleaseGateError,
        match="seeded_catalog_authorship_retained",
    ):
        verify_release_gate(session, manifest)
