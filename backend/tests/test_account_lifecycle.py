from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from threading import Event
from typing import cast
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, delete, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

import app.services.account_lifecycle as account_lifecycle_service
from app.core.config import Settings
from app.models import (
    AbuseRateLimitBucket,
    CatalogCurator,
    CommunityModerator,
    IngredientCatalogAuditEvent,
    IngredientCatalogRequest,
    OIDCIdentity,
    PreferenceEvent,
    RecipeDraft,
    RecipeDraftCategory,
    RecipeDraftInstruction,
    RecipeDuplicateCandidate,
    RecipeDuplicateDecision,
    RecipeDuplicatePreflight,
    RecipeLineage,
    RecipeModerationAuditEvent,
    RecipeModerationCase,
    RecipeRating,
    RecipeReport,
    RecipeSave,
    RecipeVersion,
    RecipeVersionCategory,
    RecipeVersionPublication,
    User,
    UserSession,
)
from app.repositories.account_lifecycle import (
    DELETED_MODERATION_FINGERPRINT,
    DELETED_REPORT_FINGERPRINT,
    get_account_user_for_update,
)
from app.repositories.auth import get_user_session_by_id
from app.seeds.identifiers import seed_uuid
from app.services.account_lifecycle import delete_member_account
from app.services.auth import issue_member_session, resolve_authenticated_session
from app.services.oidc import VerifiedOIDCIdentity
from app.services.recipe_responses import recipe_summary_response


def _settings() -> Settings:
    return Settings.model_validate(
        {
            "app_environment": "test",
            "auth_session_ttl_seconds": 3600,
            "auth_recent_ttl_seconds": 600,
        }
    )


def _identity(authenticated_at: datetime) -> VerifiedOIDCIdentity:
    return VerifiedOIDCIdentity(
        issuer="https://identity.example.test",
        subject="deleting-member-subject",
        email="delete-me@example.test",
        email_verified=True,
        suggested_display_name="Delete Me",
        authenticated_at=authenticated_at,
    )


def test_account_deletion_tombstones_authorship_and_erases_private_member_state(
    db_session: Session,
) -> None:
    now = datetime.now(UTC)
    settings = _settings()
    issued = issue_member_session(
        db_session,
        settings=settings,
        identity=_identity(now),
        return_path="/account/settings",
        now=now,
    )
    issue_member_session(
        db_session,
        settings=settings,
        identity=_identity(now),
        return_path="/",
        now=now,
    )
    issued.user.handle = "delete-me"
    deleting_user_id = issued.user.id

    lineage = RecipeLineage(created_by_user_id=deleting_user_id)
    db_session.add(lineage)
    db_session.flush()
    version = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=None,
        created_by_user_id=deleting_user_id,
        version_number=1,
        title="Recipe that remains public",
        description="Published content remains immutable.",
        servings=Decimal("4.00"),
    )
    db_session.add(version)
    db_session.flush()
    active_draft = RecipeDraft(
        author_user_id=deleting_user_id,
        title="Private active draft",
        description="Private active notes",
    )
    published_draft = RecipeDraft(
        author_user_id=deleting_user_id,
        source_version_id=version.id,
        status="published",
        title="Private publication workspace",
        description="Private publication notes",
        servings=Decimal("4.00"),
    )
    db_session.add_all([active_draft, published_draft])
    db_session.flush()
    breakfast_category_id = seed_uuid(
        "recipe-lab-demo-v1",
        "recipe-category",
        "breakfast",
    )
    db_session.add_all(
        [
            RecipeDraftCategory(
                recipe_draft_id=active_draft.id,
                recipe_category_id=breakfast_category_id,
                display_order=0,
            ),
            RecipeDraftCategory(
                recipe_draft_id=published_draft.id,
                recipe_category_id=breakfast_category_id,
                display_order=0,
            ),
            RecipeVersionCategory(
                recipe_version_id=version.id,
                recipe_category_id=breakfast_category_id,
                category_name="Breakfast",
                category_slug="breakfast",
                display_order=0,
            ),
        ]
    )
    db_session.flush()

    abandoned_preflight = RecipeDuplicatePreflight(
        actor_user_id=deleting_user_id,
        action_id=uuid4(),
        request_fingerprint="1" * 64,
        source_version_id=version.id,
        subject_fingerprint_algorithm="test.v1",
        subject_fingerprint_digest="2" * 64,
        policy_version="test.v1",
        classification="exact_duplicate",
        same_parent_no_change=True,
        result_digest="3" * 64,
    )
    bound_preflight = RecipeDuplicatePreflight(
        actor_user_id=deleting_user_id,
        action_id=uuid4(),
        request_fingerprint="4" * 64,
        source_version_id=None,
        subject_fingerprint_algorithm="test.v1",
        subject_fingerprint_digest="5" * 64,
        policy_version="test.v1",
        classification="distinct",
        same_parent_no_change=False,
        result_digest="6" * 64,
    )
    db_session.add_all([abandoned_preflight, bound_preflight])
    db_session.flush()

    publication = RecipeVersionPublication(
        recipe_version_id=version.id,
        actor_user_id=deleting_user_id,
        state_changed_by_user_id=deleting_user_id,
        source_draft_id=published_draft.id,
        action_id=bound_preflight.action_id,
        request_fingerprint=bound_preflight.request_fingerprint,
        draft_revision=published_draft.revision,
        duplicate_preflight_id=bound_preflight.id,
        duplicate_policy_version=bound_preflight.policy_version,
        duplicate_result_digest=bound_preflight.result_digest,
    )
    pending_request = IngredientCatalogRequest(
        requester_user_id=deleting_user_id,
        proposed_name="Private pending ingredient",
        normalized_name="private pending ingredient",
        normalized_name_digest="7" * 64,
        context="Private pending context",
    )
    terminal_request = IngredientCatalogRequest(
        requester_user_id=deleting_user_id,
        proposed_name="Reviewed ingredient",
        normalized_name="reviewed ingredient",
        normalized_name_digest="8" * 64,
        context="Private terminal context",
        status="rejected",
        reviewer_user_id=deleting_user_id,
        reviewed_at=now,
        decision_reason="Not suitable for the catalog.",
    )
    db_session.add_all([publication, pending_request, terminal_request])
    db_session.flush()
    moderation_case = RecipeModerationCase(
        recipe_version_id=version.id,
        status="open",
        opened_at=now,
        reporter_count=1,
        last_reported_at=now,
        updated_at=now,
    )
    db_session.add(moderation_case)
    db_session.flush()
    retained_report = RecipeReport(
        recipe_version_id=version.id,
        reporter_user_id=deleting_user_id,
        reason="other",
        details="Private report details must be erased.",
        action_id=uuid4(),
        request_fingerprint="9" * 64,
    )
    retained_moderation_event = RecipeModerationAuditEvent(
        recipe_version_id=version.id,
        actor_user_id=deleting_user_id,
        action="hide",
        previous_status="open",
        status="open",
        visibility_state="moderation_hidden",
        private_note="Private moderator note must be erased.",
        action_id=uuid4(),
        request_fingerprint="b" * 64,
        occurred_at=now,
    )
    db_session.add_all([retained_report, retained_moderation_event])
    db_session.flush()
    retained_report_id = retained_report.id
    retained_moderation_event_id = retained_moderation_event.id
    version_id = version.id
    active_draft_id = active_draft.id
    published_draft_id = published_draft.id
    pending_request_id = pending_request.id
    terminal_request_id = terminal_request.id
    abandoned_preflight_id = abandoned_preflight.id
    bound_preflight_id = bound_preflight.id
    terminal_submission = IngredientCatalogAuditEvent(
        request_id=terminal_request.id,
        actor_user_id=deleting_user_id,
        event_type="submitted",
        payload={
            "proposed_name": terminal_request.proposed_name,
            "context": terminal_request.context,
        },
    )
    terminal_decision = IngredientCatalogAuditEvent(
        request_id=terminal_request.id,
        actor_user_id=deleting_user_id,
        event_type="rejected",
        payload={"decision_reason": terminal_request.decision_reason},
    )
    db_session.add_all(
        [
            IngredientCatalogAuditEvent(
                request_id=pending_request.id,
                actor_user_id=deleting_user_id,
                event_type="submitted",
                payload={
                    "proposed_name": pending_request.proposed_name,
                    "context": pending_request.context,
                },
            ),
            terminal_submission,
            terminal_decision,
            RecipeDuplicateCandidate(
                preflight_id=abandoned_preflight.id,
                public_recipe_version_id=version.id,
                rank=1,
                classification="exact_duplicate",
                score_basis_points=10_000,
                reason_codes=["exact_structural_match"],
                fingerprint_algorithm_version=abandoned_preflight.subject_fingerprint_algorithm,
                policy_version=abandoned_preflight.policy_version,
                exact_payload_confirmed=True,
            ),
            RecipeDuplicateDecision(
                preflight_id=abandoned_preflight.id,
                actor_user_id=deleting_user_id,
                action_id=uuid4(),
                decision="continue",
                acknowledged_policy_version=abandoned_preflight.policy_version,
                acknowledged_result_digest=abandoned_preflight.result_digest,
            ),
            RecipeDraftInstruction(
                recipe_draft_id=active_draft.id,
                instruction="A private active instruction.",
                display_order=0,
            ),
            RecipeDraftInstruction(
                recipe_draft_id=published_draft.id,
                instruction="A private publication instruction.",
                display_order=0,
            ),
            RecipeSave(user_id=deleting_user_id, recipe_version_id=version.id),
            RecipeRating(
                user_id=deleting_user_id,
                recipe_version_id=version.id,
                rating=5,
            ),
            PreferenceEvent(
                user_id=deleting_user_id,
                recipe_version_id=version.id,
                event_type="view",
            ),
            CatalogCurator(user_id=deleting_user_id, granted_by_user_id=None),
            CommunityModerator(user_id=deleting_user_id, granted_by_user_id=None),
            AbuseRateLimitBucket(
                operation="interaction",
                dimension="account",
                subject_digest="a" * 64,
                account_user_id=deleting_user_id,
                window_started_at=now,
                request_count=1,
                expires_at=now + timedelta(minutes=1),
            ),
        ]
    )
    db_session.flush()
    terminal_submission_id = terminal_submission.id
    terminal_decision_id = terminal_decision.id

    authenticated = resolve_authenticated_session(
        db_session,
        raw_session_token=issued.session_token,
        now=now,
        touch=False,
    )
    assert authenticated is not None
    delete_member_account(
        db_session,
        authenticated=authenticated,
        confirmation="delete-me",
        recent_auth_ttl_seconds=settings.auth_recent_ttl_seconds,
        now=now,
    )
    db_session.expire_all()

    tombstone = db_session.get(User, deleting_user_id)
    assert tombstone is not None
    assert tombstone.status == "deleted"
    assert tombstone.deleted_at == now
    assert tombstone.email is None
    assert tombstone.handle is None
    assert tombstone.display_name == "Deleted cook"
    assert db_session.scalar(select(func.count()).select_from(OIDCIdentity)) == 0
    assert db_session.scalar(select(func.count()).select_from(UserSession)) == 0
    assert db_session.scalar(select(func.count()).select_from(RecipeSave)) == 0
    assert db_session.scalar(select(func.count()).select_from(RecipeRating)) == 0
    assert db_session.scalar(select(func.count()).select_from(PreferenceEvent)) == 0
    assert db_session.scalar(select(func.count()).select_from(CatalogCurator)) == 0
    assert db_session.scalar(select(func.count()).select_from(CommunityModerator)) == 0
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(AbuseRateLimitBucket)
            .where(AbuseRateLimitBucket.account_user_id == deleting_user_id)
        )
        == 0
    )
    anonymized_report = db_session.get(RecipeReport, retained_report_id)
    assert anonymized_report is not None
    assert anonymized_report.reporter_user_id == deleting_user_id
    assert anonymized_report.details is None
    assert anonymized_report.request_fingerprint == DELETED_REPORT_FINGERPRINT
    anonymized_moderation_event = db_session.get(
        RecipeModerationAuditEvent,
        retained_moderation_event_id,
    )
    assert anonymized_moderation_event is not None
    assert anonymized_moderation_event.actor_user_id == deleting_user_id
    assert anonymized_moderation_event.action == "hide"
    assert anonymized_moderation_event.private_note is None
    assert anonymized_moderation_event.request_fingerprint == DELETED_MODERATION_FINGERPRINT
    assert db_session.get(RecipeDraft, active_draft_id) is None
    assert db_session.scalar(select(func.count()).select_from(RecipeDraftCategory)) == 0
    assert db_session.get(IngredientCatalogRequest, pending_request_id) is None
    retained_request = db_session.get(IngredientCatalogRequest, terminal_request_id)
    assert retained_request is not None
    assert retained_request.context is None
    retained_submission = db_session.get(IngredientCatalogAuditEvent, terminal_submission_id)
    assert retained_submission is not None
    assert retained_submission.payload == {"proposed_name": "Reviewed ingredient"}
    retained_decision = db_session.get(IngredientCatalogAuditEvent, terminal_decision_id)
    assert retained_decision is not None
    assert retained_decision.payload == {"decision_reason": "Not suitable for the catalog."}
    assert db_session.get(RecipeDuplicatePreflight, abandoned_preflight_id) is None
    assert db_session.get(RecipeDuplicatePreflight, bound_preflight_id) is not None

    retained_draft = db_session.get(RecipeDraft, published_draft_id)
    assert retained_draft is not None
    assert retained_draft.title == ""
    assert retained_draft.description is None
    assert retained_draft.servings is None
    assert db_session.scalar(select(func.count()).select_from(RecipeDraftInstruction)) == 0
    retained_version = db_session.get(RecipeVersion, version_id)
    assert retained_version is not None
    retained_publication = db_session.get(RecipeVersionPublication, version_id)
    assert retained_publication is not None
    assert retained_publication.state == "published"
    retained_categories = list(
        db_session.scalars(
            select(RecipeVersionCategory).where(
                RecipeVersionCategory.recipe_version_id == version_id
            )
        )
    )
    assert [(item.category_name, item.category_slug) for item in retained_categories] == [
        ("Breakfast", "breakfast")
    ]
    public_recipe = recipe_summary_response(retained_version)
    assert public_recipe.author.model_dump(mode="json") == {
        "id": str(deleting_user_id),
        "handle": None,
        "display_name": "Deleted cook",
    }
    assert [item.slug for item in public_recipe.categories] == ["breakfast"]

    with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
        db_session.execute(
            delete(RecipeDuplicatePreflight).where(
                RecipeDuplicatePreflight.id == bound_preflight_id
            )
        )
        db_session.flush()
    with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
        db_session.execute(
            text(
                "UPDATE ingredient_catalog_audit_events "
                "SET payload = '{}'::jsonb WHERE id = :event_id"
            ),
            {"event_id": terminal_decision_id},
        )
    with pytest.raises(DBAPIError, match="append-only"), db_session.begin_nested():
        db_session.execute(
            text(
                "UPDATE recipe_moderation_audit_events "
                "SET private_note = 'restored private note' WHERE id = :event_id"
            ),
            {"event_id": retained_moderation_event_id},
        )


def test_account_deletion_waits_for_another_session_before_locking_the_user(
    empty_postgres_engine: Engine,
    alembic_config: Config,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")

    now = datetime.now(UTC)
    with Session(bind=empty_postgres_engine) as setup, setup.begin():
        first = issue_member_session(
            setup,
            settings=_settings(),
            identity=_identity(now),
            return_path="/account/settings",
            now=now,
        )
        second = issue_member_session(
            setup,
            settings=_settings(),
            identity=_identity(now),
            return_path="/recipes",
            now=now,
        )
        first.user.handle = "concurrent-delete"
        user_id = first.user.id
        first_token = first.session_token
        second_token = second.session_token

    with Session(bind=empty_postgres_engine) as lookup:
        deleting_session = resolve_authenticated_session(
            lookup,
            raw_session_token=first_token,
            now=now,
            touch=False,
        )
        other_session = resolve_authenticated_session(
            lookup,
            raw_session_token=second_token,
            now=now,
            touch=False,
        )
    assert deleting_session is not None
    assert other_session is not None

    other_session_locked = Event()
    deletion_locking_sessions = Event()
    original_lock_sessions = cast(
        Callable[[Session, UUID], list[UserSession]],
        account_lifecycle_service.__dict__["list_user_sessions_for_update"],
    )

    def observed_lock_sessions(session: Session, actor_user_id: UUID) -> list[UserSession]:
        deletion_locking_sessions.set()
        return original_lock_sessions(session, actor_user_id)

    monkeypatch.setattr(
        account_lifecycle_service,
        "list_user_sessions_for_update",
        observed_lock_sessions,
    )

    def finish_other_member_request() -> None:
        with Session(bind=empty_postgres_engine) as session, session.begin():
            session.execute(text("SET LOCAL lock_timeout = '5s'"))
            assert (
                get_user_session_by_id(
                    session,
                    other_session.session_id,
                    for_update=True,
                )
                is not None
            )
            other_session_locked.set()
            assert deletion_locking_sessions.wait(timeout=5)
            user = get_account_user_for_update(session, user_id)
            assert user is not None
            assert user.status == "active"

    def delete_account() -> None:
        assert other_session_locked.wait(timeout=5)
        with Session(bind=empty_postgres_engine) as session, session.begin():
            session.execute(text("SET LOCAL lock_timeout = '5s'"))
            delete_member_account(
                session,
                authenticated=deleting_session,
                confirmation="concurrent-delete",
                recent_auth_ttl_seconds=600,
                now=now,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        other_request = executor.submit(finish_other_member_request)
        deletion = executor.submit(delete_account)
        other_request.result(timeout=10)
        deletion.result(timeout=10)

    with Session(bind=empty_postgres_engine) as session:
        tombstone = session.get(User, user_id)
        assert tombstone is not None
        assert tombstone.status == "deleted"
        assert session.scalar(select(func.count()).select_from(UserSession)) == 0
