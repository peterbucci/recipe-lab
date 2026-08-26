"""Privacy-safe evidence harness for the RCP-32 community release gate.

The guarded staging command writes only three deterministic legacy Demo Cook
interactions before the journey. The verifier itself is deliberately read-only:
it accepts an opaque manifest of database identifiers, proves the release
journey against an isolated PostgreSQL database, and emits only stable check
names and counts. The companion artifact scanner prevents private acceptance
canaries and browser credentials from being retained in CI artifacts.
"""

import argparse
import json
import os
import re
import zipfile
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, fields
from pathlib import Path
from typing import Any, BinaryIO, TypedDict, cast
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.core.demo_identity import DEMO_USER_ID
from app.models import (
    ACCOUNT_KIND_DEMO,
    ACCOUNT_KIND_MEMBER,
    ACCOUNT_KIND_SYSTEM,
    CATALOG_REQUEST_APPROVED,
    MODERATION_ACTION_HIDE,
    MODERATION_ACTION_RESOLVE,
    MODERATION_ACTION_RESTORE,
    MODERATION_CASE_RESOLVED,
    RECIPE_DRAFT_STATUS_ACTIVE,
    RECIPE_DRAFT_STATUS_PUBLISHED,
    RECIPE_DUPLICATE_DECISION_CONTINUE,
    RECIPE_DUPLICATE_EXACT,
    RECIPE_DUPLICATE_PROBABLE,
    RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN,
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    USER_STATUS_ACTIVE,
    USER_STATUS_DELETED,
    CatalogCurator,
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
    UserSession,
)
from app.repositories.account_lifecycle import DELETED_REPORT_FINGERPRINT
from app.seeds import load_bundled_catalog
from app.seeds.identifiers import seed_uuid

MANIFEST_VERSION = 1
PRIMARY_ACCEPTANCE_DATABASE_NAMES = frozenset(
    {
        "recipe_lab_rcp32_acceptance",
        "recipe_lab_rcp32_acceptance_local",
    }
)
ACCEPTANCE_DATABASE_NAMES = frozenset(
    PRIMARY_ACCEPTANCE_DATABASE_NAMES
    | {
        "recipe_lab_rcp32_acceptance_restore",
        "recipe_lab_rcp32_acceptance_local_restore",
    }
)
DEMO_ACTIVITY_RECIPE_KEY = "carrot-walnut-snack-cake-v1"
DEMO_ACTIVITY_RATING = 4
_DEMO_ACTIVITY_NAMESPACE = uuid5(
    NAMESPACE_URL,
    "https://github.com/peterbucci/recipe-lab/rcp32/demo-activity-v1",
)
DEMO_ACTIVITY_VIEW_EVENT_ID = uuid5(_DEMO_ACTIVITY_NAMESPACE, "view-event")
DEMO_ACTIVITY_VIEW_ACTION_ID = uuid5(_DEMO_ACTIVITY_NAMESPACE, "view-action")
_MAX_MANIFEST_BYTES = 64 * 1024
_SCAN_CHUNK_BYTES = 64 * 1024
_SCAN_OVERLAP_BYTES = 256
_MAX_ARCHIVE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024


class CommunityReleaseGateError(RuntimeError):
    """Raised when release evidence is missing, unsafe, or privacy-sensitive."""


class CheckResult(TypedDict):
    name: str
    count: int


class ReleaseGateSummary(TypedDict):
    version: int
    checks: list[CheckResult]


@dataclass(frozen=True, slots=True)
class CommunityReleaseManifest:
    """Opaque identifiers produced by the two-member acceptance journey."""

    version: int
    alice_user_id: UUID
    bob_user_id: UUID
    curator_user_id: UUID
    moderator_user_id: UUID
    root_recipe_version_id: UUID
    child_recipe_version_id: UUID
    ingredient_request_id: UUID
    approved_ingredient_id: UUID
    exact_preflight_id: UUID
    probable_preflight_id: UUID
    report_id: UUID


_MANIFEST_KEYS = frozenset(field.name for field in fields(CommunityReleaseManifest))
_MANIFEST_UUID_KEYS = _MANIFEST_KEYS - {"version"}

_STATIC_PRIVATE_MARKERS = (
    b"alice@rcp32.recipe-lab.invalid",
    b"bob@rcp32.recipe-lab.invalid",
    b"curator@rcp32.recipe-lab.invalid",
    b"moderator@rcp32.recipe-lab.invalid",
    b"rcp32-alice",
    b"rcp32-bob",
    b"rcp32-curator",
    b"rcp32-moderator",
    b"rcp32_private_report_canary",
    b"rcp32_private_moderator_note_canary",
    b"rcp32_private_request_context_canary",
    b"rcp32_private_curator_decision_reason_canary",
    b"rcp32_private_curator_provenance_canary",
    b"recipe_lab_session=",
    b"recipe_lab_csrf=",
    b"recipe_lab_login=",
    b"x-csrf-token",
    b"?code=",
    b"&code=",
    b"?state=",
    b"&state=",
)
_PRIVATE_HEADER_PATTERNS = (
    re.compile(rb"x-csrf-token\s*[:=]", re.IGNORECASE),
    re.compile(rb"\bauthorization\b[^\r\n]{0,160}\bbearer\b", re.IGNORECASE),
)


def _privacy_safe_failure(check_name: str) -> None:
    raise CommunityReleaseGateError(f"Release evidence check {check_name!r} failed.")


def _require(condition: bool, check_name: str) -> None:
    if not condition:
        _privacy_safe_failure(check_name)


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise CommunityReleaseGateError("The release manifest contains duplicate keys.")
        value[key] = item
    return value


def parse_manifest(value: object) -> CommunityReleaseManifest:
    """Parse one exact-version manifest without accepting coercions or extra data."""

    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise CommunityReleaseGateError("The release manifest must be a JSON object.")
    raw = cast(dict[str, object], value)
    if frozenset(raw) != _MANIFEST_KEYS:
        raise CommunityReleaseGateError("The release manifest keys do not match version 1.")
    version = raw["version"]
    if isinstance(version, bool) or not isinstance(version, int) or version != MANIFEST_VERSION:
        raise CommunityReleaseGateError("The release manifest version is unsupported.")

    parsed_ids: dict[str, UUID] = {}
    for key in _MANIFEST_UUID_KEYS:
        candidate = raw[key]
        if not isinstance(candidate, str):
            raise CommunityReleaseGateError("The release manifest contains an invalid UUID.")
        try:
            parsed = UUID(candidate)
        except (ValueError, AttributeError) as error:
            raise CommunityReleaseGateError(
                "The release manifest contains an invalid UUID."
            ) from error
        if str(parsed) != candidate:
            raise CommunityReleaseGateError(
                "The release manifest UUIDs must use canonical lowercase form."
            )
        parsed_ids[key] = parsed

    manifest = CommunityReleaseManifest(version=version, **parsed_ids)
    release_user_ids = {
        manifest.alice_user_id,
        manifest.bob_user_id,
        manifest.curator_user_id,
        manifest.moderator_user_id,
    }
    if len(release_user_ids) != 4 or DEMO_USER_ID in release_user_ids:
        raise CommunityReleaseGateError("The release manifest actor roles must be distinct.")
    if manifest.root_recipe_version_id == manifest.child_recipe_version_id:
        raise CommunityReleaseGateError("The release manifest recipe versions must be distinct.")
    if manifest.exact_preflight_id == manifest.probable_preflight_id:
        raise CommunityReleaseGateError("The release manifest preflights must be distinct.")
    return manifest


def load_manifest(path: Path) -> CommunityReleaseManifest:
    """Read a bounded JSON manifest while detecting duplicate object keys."""

    try:
        payload = path.read_bytes()
    except OSError as error:
        raise CommunityReleaseGateError("The release manifest could not be read.") from error
    if not payload or len(payload) > _MAX_MANIFEST_BYTES:
        raise CommunityReleaseGateError("The release manifest has an invalid size.")
    try:
        decoded = payload.decode("utf-8")
        raw = json.loads(decoded, object_pairs_hook=_reject_duplicate_keys)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CommunityReleaseGateError("The release manifest is not valid JSON.") from error
    return parse_manifest(raw)


def validate_release_gate_environment(environment: Mapping[str, str]) -> str:
    """Return a guarded PostgreSQL URL or reject anything but disposable RCP-32 DBs."""

    if environment.get("RCP32_ACCEPTANCE") != "1":
        raise CommunityReleaseGateError("RCP32_ACCEPTANCE=1 is required.")
    if environment.get("ACCEPTANCE_DATABASE_ISOLATED") != "1":
        raise CommunityReleaseGateError("ACCEPTANCE_DATABASE_ISOLATED=1 is required.")
    database_url = environment.get("DATABASE_URL", "").strip()
    if not database_url:
        raise CommunityReleaseGateError("DATABASE_URL is required.")
    try:
        parsed = make_url(database_url)
    except Exception as error:
        raise CommunityReleaseGateError("DATABASE_URL is invalid.") from error
    if parsed.get_backend_name() != "postgresql":
        raise CommunityReleaseGateError("The release gate database must use PostgreSQL.")
    if parsed.database not in ACCEPTANCE_DATABASE_NAMES:
        raise CommunityReleaseGateError("The release gate refused a non-disposable database.")
    return database_url


def validate_stage_demo_environment(environment: Mapping[str, str]) -> str:
    """Allow fixture writes only on a primary disposable RCP-32 database."""

    database_url = validate_release_gate_environment(environment)
    if make_url(database_url).database not in PRIMARY_ACCEPTANCE_DATABASE_NAMES:
        raise CommunityReleaseGateError("Demo activity staging is forbidden on a restore database.")
    return database_url


def _count(
    session: Session,
    model: type[Any],
    *criteria: ColumnElement[bool],
) -> int:
    statement = select(func.count()).select_from(model)
    if criteria:
        statement = statement.where(*criteria)
    return int(session.scalar(statement) or 0)


def _demo_activity_recipe_id(session: Session) -> UUID:
    catalog = load_bundled_catalog()
    _require(
        any(recipe.key == DEMO_ACTIVITY_RECIPE_KEY for recipe in catalog.recipes),
        "demo_activity_seed_contract",
    )
    recipe_version_id = seed_uuid(
        catalog.metadata.dataset_id,
        "recipe-version",
        DEMO_ACTIVITY_RECIPE_KEY,
    )
    catalog_owner_id = seed_uuid(catalog.metadata.dataset_id, "user", "catalog-author")
    demo_user = session.get(User, DEMO_USER_ID)
    catalog_owner = session.get(User, catalog_owner_id)
    recipe = session.get(RecipeVersion, recipe_version_id)
    publication = session.get(RecipeVersionPublication, recipe_version_id)
    _require(
        demo_user is not None
        and demo_user.account_kind == ACCOUNT_KIND_DEMO
        and catalog_owner is not None
        and catalog_owner.account_kind == ACCOUNT_KIND_SYSTEM
        and recipe is not None
        and recipe.created_by_user_id == catalog_owner_id
        and publication is not None
        and publication.state == RECIPE_PUBLICATION_STATE_PUBLISHED,
        "demo_activity_seed_contract",
    )
    return recipe_version_id


def stage_demo_activity(session: Session) -> ReleaseGateSummary:
    """Idempotently stage three deterministic legacy Demo Cook interaction rows."""

    recipe_version_id = _demo_activity_recipe_id(session)
    save_key = {
        "user_id": DEMO_USER_ID,
        "recipe_version_id": recipe_version_id,
    }
    rating_key = dict(save_key)
    existing_save = session.get(RecipeSave, save_key)
    existing_rating = session.get(RecipeRating, rating_key)
    _require(
        existing_rating is None or existing_rating.rating == DEMO_ACTIVITY_RATING,
        "demo_activity_conflict",
    )

    event_by_id = session.get(PreferenceEvent, DEMO_ACTIVITY_VIEW_EVENT_ID)
    events_by_action = list(
        session.scalars(
            select(PreferenceEvent).where(PreferenceEvent.action_id == DEMO_ACTIVITY_VIEW_ACTION_ID)
        )
    )
    if event_by_id is None:
        _require(not events_by_action, "demo_activity_conflict")
    else:
        _require(
            event_by_id.user_id == DEMO_USER_ID
            and event_by_id.action_id == DEMO_ACTIVITY_VIEW_ACTION_ID
            and event_by_id.recipe_version_id == recipe_version_id
            and event_by_id.event_type == "view"
            and event_by_id.saved_value is None
            and event_by_id.rating_value is None
            and event_by_id.related_recipe_version_id is None
            and event_by_id.request_fingerprint is None
            and len(events_by_action) == 1
            and events_by_action[0].id == event_by_id.id,
            "demo_activity_conflict",
        )

    if existing_save is None:
        session.add(RecipeSave(**save_key))
    if existing_rating is None:
        session.add(RecipeRating(**rating_key, rating=DEMO_ACTIVITY_RATING))
    if event_by_id is None:
        session.add(
            PreferenceEvent(
                id=DEMO_ACTIVITY_VIEW_EVENT_ID,
                action_id=DEMO_ACTIVITY_VIEW_ACTION_ID,
                user_id=DEMO_USER_ID,
                recipe_version_id=recipe_version_id,
                event_type="view",
            )
        )
    session.flush()
    return {
        "version": MANIFEST_VERSION,
        "checks": [{"name": "demo_activity_rows_staged", "count": 3}],
    }


def _check_user_lifecycle(
    session: Session,
    manifest: CommunityReleaseManifest,
) -> list[CheckResult]:
    alice = session.get(User, manifest.alice_user_id)
    bob = session.get(User, manifest.bob_user_id)
    curator = session.get(User, manifest.curator_user_id)
    moderator = session.get(User, manifest.moderator_user_id)
    _require(
        alice is not None
        and alice.account_kind == ACCOUNT_KIND_MEMBER
        and alice.status == USER_STATUS_ACTIVE
        and alice.deleted_at is None
        and alice.email is not None
        and alice.handle is not None,
        "alice_active_member",
    )
    alice_identity_count = _count(
        session,
        OIDCIdentity,
        OIDCIdentity.user_id == manifest.alice_user_id,
    )
    _require(alice_identity_count >= 1, "alice_oidc_identity")
    _require(
        bob is not None
        and bob.account_kind == ACCOUNT_KIND_MEMBER
        and bob.status == USER_STATUS_DELETED
        and bob.deleted_at is not None
        and bob.email is None
        and bob.handle is None
        and bob.display_name == "Deleted cook",
        "bob_account_tombstone",
    )
    _require(
        curator is not None
        and curator.account_kind == ACCOUNT_KIND_MEMBER
        and curator.status == USER_STATUS_ACTIVE,
        "curator_active_member",
    )
    _require(
        moderator is not None
        and moderator.account_kind == ACCOUNT_KIND_MEMBER
        and moderator.status == USER_STATUS_ACTIVE,
        "moderator_active_member",
    )

    erased_private_store_counts = (
        _count(session, OIDCIdentity, OIDCIdentity.user_id == manifest.bob_user_id),
        _count(session, UserSession, UserSession.user_id == manifest.bob_user_id),
        _count(session, RecipeSave, RecipeSave.user_id == manifest.bob_user_id),
        _count(session, RecipeRating, RecipeRating.user_id == manifest.bob_user_id),
        _count(session, PreferenceEvent, PreferenceEvent.user_id == manifest.bob_user_id),
    )
    _require(not any(erased_private_store_counts), "bob_private_data_erased")
    active_draft_count = _count(
        session,
        RecipeDraft,
        RecipeDraft.author_user_id == manifest.bob_user_id,
        RecipeDraft.status == RECIPE_DRAFT_STATUS_ACTIVE,
    )
    _require(active_draft_count == 0, "bob_private_data_erased")
    retained_drafts = list(
        session.scalars(
            select(RecipeDraft).where(RecipeDraft.author_user_id == manifest.bob_user_id)
        )
    )
    _require(
        all(
            draft.status == RECIPE_DRAFT_STATUS_PUBLISHED
            and draft.title == ""
            and draft.description is None
            and draft.servings is None
            for draft in retained_drafts
        ),
        "bob_published_draft_scrubbed",
    )
    return [
        {"name": "release_member_lifecycle", "count": 4},
        {"name": "alice_oidc_identities", "count": alice_identity_count},
        {
            "name": "bob_private_stores_erased",
            "count": len(erased_private_store_counts) + 1,
        },
        {"name": "bob_published_drafts_scrubbed", "count": len(retained_drafts)},
    ]


def _check_lineage_and_publication(
    session: Session,
    manifest: CommunityReleaseManifest,
) -> list[CheckResult]:
    root = session.get(RecipeVersion, manifest.root_recipe_version_id)
    child = session.get(RecipeVersion, manifest.child_recipe_version_id)
    _require(root is not None and child is not None, "release_recipe_versions")
    assert root is not None and child is not None
    lineage = session.get(RecipeLineage, root.lineage_id)
    _require(
        lineage is not None
        and lineage.created_by_user_id == manifest.alice_user_id
        and root.created_by_user_id == manifest.alice_user_id
        and root.parent_version_id is None
        and root.version_number == 1
        and child.lineage_id == root.lineage_id
        and child.parent_version_id == root.id
        and child.created_by_user_id == manifest.bob_user_id
        and child.version_number > root.version_number,
        "root_child_lineage",
    )
    root_publication = session.get(RecipeVersionPublication, root.id)
    child_publication = session.get(RecipeVersionPublication, child.id)
    _require(
        root_publication is not None
        and root_publication.actor_user_id == manifest.alice_user_id
        and root_publication.state == RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN
        and root_publication.author_withdrawn_at is not None
        and root_publication.moderation_hidden_at is None
        and root_publication.state_changed_by_user_id == manifest.alice_user_id,
        "root_final_unavailable",
    )
    _require(
        child_publication is not None
        and child_publication.actor_user_id == manifest.bob_user_id
        and child_publication.state == RECIPE_PUBLICATION_STATE_PUBLISHED,
        "child_public_tombstone_retained",
    )
    assert root_publication is not None and child_publication is not None
    return [
        {"name": "root_child_lineage_versions", "count": 2},
        {"name": "final_publication_states", "count": 2},
    ]


def _check_catalog_and_roles(
    session: Session,
    manifest: CommunityReleaseManifest,
) -> list[CheckResult]:
    ingredient = session.get(Ingredient, manifest.approved_ingredient_id)
    request = session.get(IngredientCatalogRequest, manifest.ingredient_request_id)
    _require(ingredient is not None and request is not None, "approved_ingredient_request")
    assert request is not None
    _require(
        request.status == CATALOG_REQUEST_APPROVED
        and request.requester_user_id == manifest.alice_user_id
        and request.reviewer_user_id == manifest.curator_user_id
        and request.resolved_ingredient_id == manifest.approved_ingredient_id
        and request.reviewed_at is not None,
        "approved_ingredient_request",
    )
    root_ingredient_count = _count(
        session,
        RecipeIngredient,
        RecipeIngredient.recipe_version_id == manifest.root_recipe_version_id,
        RecipeIngredient.ingredient_id == manifest.approved_ingredient_id,
    )
    _require(root_ingredient_count >= 1, "approved_ingredient_used_by_root")

    _require(
        session.get(CatalogCurator, manifest.curator_user_id) is None
        and session.get(CommunityModerator, manifest.curator_user_id) is None
        and _count(
            session,
            RecipeModerationAuditEvent,
            RecipeModerationAuditEvent.actor_user_id == manifest.curator_user_id,
        )
        == 0,
        "curator_grant_revoked_and_separate",
    )
    moderator_audit_count = _count(
        session,
        RecipeModerationAuditEvent,
        RecipeModerationAuditEvent.actor_user_id == manifest.moderator_user_id,
    )
    moderator_review_count = _count(
        session,
        IngredientCatalogRequest,
        IngredientCatalogRequest.reviewer_user_id == manifest.moderator_user_id,
    )
    _require(
        session.get(CommunityModerator, manifest.moderator_user_id) is None
        and session.get(CatalogCurator, manifest.moderator_user_id) is None
        and moderator_audit_count >= 1
        and moderator_review_count == 0,
        "moderator_grant_revoked_and_separate",
    )
    return [
        {"name": "approved_catalog_request_and_use", "count": root_ingredient_count + 1},
        {"name": "revoked_separate_role_grants", "count": 4},
    ]


def _check_duplicate_evidence(
    session: Session,
    manifest: CommunityReleaseManifest,
) -> list[CheckResult]:
    exact = session.get(RecipeDuplicatePreflight, manifest.exact_preflight_id)
    probable = session.get(RecipeDuplicatePreflight, manifest.probable_preflight_id)
    _require(
        exact is not None
        and exact.classification == RECIPE_DUPLICATE_EXACT
        and exact.actor_user_id == manifest.bob_user_id
        and exact.source_version_id == manifest.root_recipe_version_id
        and exact.same_parent_no_change
        and probable is not None
        and probable.classification == RECIPE_DUPLICATE_PROBABLE
        and probable.actor_user_id == manifest.bob_user_id
        and probable.source_version_id == manifest.root_recipe_version_id
        and not probable.same_parent_no_change,
        "duplicate_preflight_classifications",
    )
    assert exact is not None and probable is not None
    preflights = (exact, probable)
    root_version = session.get(RecipeVersion, manifest.root_recipe_version_id)
    _require(root_version is not None, "duplicate_publication_binding")
    assert root_version is not None
    decisions: dict[UUID, RecipeDuplicateDecision] = {}
    for preflight in preflights:
        decision = session.scalar(
            select(RecipeDuplicateDecision).where(
                RecipeDuplicateDecision.preflight_id == preflight.id
            )
        )
        _require(
            decision is not None
            and decision.actor_user_id == preflight.actor_user_id
            and decision.decision == RECIPE_DUPLICATE_DECISION_CONTINUE
            and decision.acknowledged_policy_version == preflight.policy_version
            and decision.acknowledged_result_digest == preflight.result_digest,
            "duplicate_continue_decisions",
        )
        assert decision is not None
        decisions[preflight.id] = decision
        # Same-parent/no-change forks take the intentional exact-match shortcut:
        # the preflight itself is durable evidence and no ranked candidate row is
        # written. A scored probable match must retain a candidate from the
        # source lineage; after the exact sibling is published, that sibling can
        # correctly outrank the original root without changing direct ancestry.
        if not preflight.same_parent_no_change:
            candidate_count = session.scalar(
                select(func.count())
                .select_from(RecipeDuplicateCandidate)
                .join(
                    RecipeVersion,
                    RecipeVersion.id == RecipeDuplicateCandidate.public_recipe_version_id,
                )
                .where(
                    RecipeDuplicateCandidate.preflight_id == preflight.id,
                    RecipeDuplicateCandidate.classification == preflight.classification,
                    RecipeVersion.lineage_id == root_version.lineage_id,
                )
            )
            _require(
                candidate_count is not None and candidate_count >= 1,
                "duplicate_candidate_evidence",
            )

    publications_by_preflight: dict[UUID, RecipeVersionPublication] = {}
    for preflight in preflights:
        publications = list(
            session.scalars(
                select(RecipeVersionPublication).where(
                    RecipeVersionPublication.duplicate_preflight_id == preflight.id
                )
            )
        )
        _require(len(publications) == 1, "duplicate_publication_binding")
        publications_by_preflight[preflight.id] = publications[0]

    exact_publication = publications_by_preflight[exact.id]
    probable_publication = publications_by_preflight[probable.id]
    _require(
        exact_publication.recipe_version_id
        not in {manifest.root_recipe_version_id, manifest.child_recipe_version_id}
        and probable_publication.recipe_version_id == manifest.child_recipe_version_id,
        "duplicate_publication_binding",
    )
    for preflight, publication in (
        (exact, exact_publication),
        (probable, probable_publication),
    ):
        decision = decisions[preflight.id]
        version = session.get(RecipeVersion, publication.recipe_version_id)
        _require(
            version is not None
            and version.lineage_id == root_version.lineage_id
            and version.parent_version_id == manifest.root_recipe_version_id
            and version.created_by_user_id == manifest.bob_user_id
            and publication.state == RECIPE_PUBLICATION_STATE_PUBLISHED
            and publication.actor_user_id == version.created_by_user_id
            and publication.actor_user_id == preflight.actor_user_id
            and publication.duplicate_policy_version == preflight.policy_version
            and publication.duplicate_result_digest == preflight.result_digest
            and publication.duplicate_decision_id == decision.id,
            "duplicate_publication_binding",
        )
    return [
        {"name": "duplicate_preflight_classifications", "count": 2},
        {"name": "duplicate_continue_publication_bindings", "count": 2},
    ]


def _check_report_privacy(
    session: Session,
    manifest: CommunityReleaseManifest,
) -> list[CheckResult]:
    report = session.get(RecipeReport, manifest.report_id)
    _require(
        report is not None
        and report.reporter_user_id == manifest.bob_user_id
        and report.recipe_version_id
        in {manifest.root_recipe_version_id, manifest.child_recipe_version_id}
        and report.details is None
        and report.request_fingerprint == DELETED_REPORT_FINGERPRINT,
        "deleted_report_scrubbed",
    )
    assert report is not None
    moderation_case = session.get(RecipeModerationCase, report.recipe_version_id)
    _require(
        moderation_case is not None
        and moderation_case.status == MODERATION_CASE_RESOLVED
        and moderation_case.resolved_at is not None,
        "moderation_audit_retained",
    )
    audit_actions = set(
        session.scalars(
            select(RecipeModerationAuditEvent.action).where(
                RecipeModerationAuditEvent.recipe_version_id == report.recipe_version_id,
                RecipeModerationAuditEvent.actor_user_id == manifest.moderator_user_id,
            )
        )
    )
    _require(
        {MODERATION_ACTION_HIDE, MODERATION_ACTION_RESTORE, MODERATION_ACTION_RESOLVE}
        <= audit_actions,
        "moderation_audit_retained",
    )
    audit_count = _count(
        session,
        RecipeModerationAuditEvent,
        RecipeModerationAuditEvent.recipe_version_id == report.recipe_version_id,
        RecipeModerationAuditEvent.actor_user_id == manifest.moderator_user_id,
    )
    _require(audit_count >= 1, "moderation_audit_retained")
    return [
        {"name": "deleted_report_scrubbed", "count": 1},
        {"name": "moderation_audit_events", "count": audit_count},
    ]


def _check_seed_identity_isolation(
    session: Session,
    manifest: CommunityReleaseManifest,
) -> list[CheckResult]:
    non_login_user_ids = list(
        session.scalars(
            select(User.id).where(User.account_kind.in_((ACCOUNT_KIND_DEMO, ACCOUNT_KIND_SYSTEM)))
        )
    )
    demo_user = session.get(User, DEMO_USER_ID)
    _require(
        demo_user is not None and demo_user.account_kind == ACCOUNT_KIND_DEMO,
        "demo_identity_retained",
    )
    identity_count = (
        _count(session, OIDCIdentity, OIDCIdentity.user_id.in_(non_login_user_ids))
        if non_login_user_ids
        else 0
    )
    _require(identity_count == 0, "non_login_accounts_have_no_oidc")

    catalog = load_bundled_catalog()
    catalog_owner_id = seed_uuid(catalog.metadata.dataset_id, "user", "catalog-author")
    catalog_owner = session.get(User, catalog_owner_id)
    _require(
        catalog_owner is not None and catalog_owner.account_kind == ACCOUNT_KIND_SYSTEM,
        "seeded_catalog_authorship_retained",
    )
    expected_version_ids = {
        seed_uuid(catalog.metadata.dataset_id, "recipe-version", recipe.key)
        for recipe in catalog.recipes
    }
    expected_lineage_ids = {
        seed_uuid(catalog.metadata.dataset_id, "recipe-lineage", recipe.key)
        for recipe in catalog.recipes
        if recipe.parent is None
    }
    seeded_versions = list(
        session.scalars(select(RecipeVersion).where(RecipeVersion.id.in_(expected_version_ids)))
    )
    seeded_lineages = list(
        session.scalars(select(RecipeLineage).where(RecipeLineage.id.in_(expected_lineage_ids)))
    )
    _require(
        len(seeded_versions) == len(expected_version_ids)
        and all(version.created_by_user_id == catalog_owner_id for version in seeded_versions)
        and len(seeded_lineages) == len(expected_lineage_ids)
        and all(lineage.created_by_user_id == catalog_owner_id for lineage in seeded_lineages),
        "seeded_catalog_authorship_retained",
    )
    release_user_ids = {
        manifest.alice_user_id,
        manifest.bob_user_id,
        manifest.curator_user_id,
        manifest.moderator_user_id,
    }
    _require(
        not any(version.created_by_user_id in release_user_ids for version in seeded_versions),
        "seeded_catalog_authorship_retained",
    )
    activity_recipe_id = _demo_activity_recipe_id(session)
    staged_save = session.get(
        RecipeSave,
        {"user_id": DEMO_USER_ID, "recipe_version_id": activity_recipe_id},
    )
    staged_rating = session.get(
        RecipeRating,
        {"user_id": DEMO_USER_ID, "recipe_version_id": activity_recipe_id},
    )
    staged_view = session.get(PreferenceEvent, DEMO_ACTIVITY_VIEW_EVENT_ID)
    _require(
        staged_save is not None
        and staged_rating is not None
        and staged_rating.rating == DEMO_ACTIVITY_RATING
        and staged_view is not None
        and staged_view.user_id == DEMO_USER_ID
        and staged_view.action_id == DEMO_ACTIVITY_VIEW_ACTION_ID
        and staged_view.recipe_version_id == activity_recipe_id
        and staged_view.event_type == "view"
        and staged_view.saved_value is None
        and staged_view.rating_value is None
        and staged_view.related_recipe_version_id is None
        and staged_view.request_fingerprint is None,
        "staged_demo_activity_retained",
    )
    reassigned_count = sum(
        (
            _count(
                session,
                RecipeSave,
                RecipeSave.user_id.in_(release_user_ids),
                RecipeSave.recipe_version_id == activity_recipe_id,
            ),
            _count(
                session,
                RecipeRating,
                RecipeRating.user_id.in_(release_user_ids),
                RecipeRating.recipe_version_id == activity_recipe_id,
            ),
            _count(
                session,
                PreferenceEvent,
                PreferenceEvent.user_id.in_(release_user_ids),
                PreferenceEvent.action_id == DEMO_ACTIVITY_VIEW_ACTION_ID,
            ),
        )
    )
    _require(reassigned_count == 0, "staged_demo_activity_not_reassigned")
    return [
        {"name": "non_login_accounts_without_oidc", "count": len(non_login_user_ids)},
        {
            "name": "seeded_catalog_versions_and_lineages",
            "count": len(seeded_versions) + len(seeded_lineages),
        },
        {"name": "staged_demo_interactions_retained", "count": 3},
    ]


def verify_release_gate(
    session: Session,
    manifest: CommunityReleaseManifest,
) -> ReleaseGateSummary:
    """Prove the complete RCP-32 database seam and return identifier-free evidence."""

    checks: list[CheckResult] = []
    checks.extend(_check_user_lifecycle(session, manifest))
    checks.extend(_check_lineage_and_publication(session, manifest))
    checks.extend(_check_catalog_and_roles(session, manifest))
    checks.extend(_check_duplicate_evidence(session, manifest))
    checks.extend(_check_report_privacy(session, manifest))
    checks.extend(_check_seed_identity_isolation(session, manifest))
    return {"version": MANIFEST_VERSION, "checks": checks}


def render_summary(summary: ReleaseGateSummary) -> str:
    """Serialize a deterministic, compact result containing no database identifiers."""

    return json.dumps(summary, sort_keys=True, separators=(",", ":"))


def _contains_private_marker(value: bytes) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in _STATIC_PRIVATE_MARKERS) or any(
        pattern.search(value) is not None for pattern in _PRIVATE_HEADER_PATTERNS
    )


def _stream_contains_private_marker(stream: BinaryIO) -> bool:
    carry = b""
    while chunk := stream.read(_SCAN_CHUNK_BYTES):
        combined = carry + chunk
        if _contains_private_marker(combined):
            return True
        carry = combined[-_SCAN_OVERLAP_BYTES:]
    return False


def _scan_zip_archive(path: Path) -> tuple[int, bool]:
    scanned = 0
    total_uncompressed = 0
    try:
        with zipfile.ZipFile(path) as archive:
            for member in sorted(archive.infolist(), key=lambda item: item.filename):
                if member.is_dir():
                    continue
                scanned += 1
                total_uncompressed += member.file_size
                if (
                    member.flag_bits & 0x1
                    or total_uncompressed > _MAX_ARCHIVE_UNCOMPRESSED_BYTES
                    or _contains_private_marker(member.filename.encode("utf-8", errors="ignore"))
                ):
                    return scanned, True
                with archive.open(member) as content:
                    if _stream_contains_private_marker(cast(BinaryIO, content)):
                        return scanned, True
    except (OSError, zipfile.BadZipFile, RuntimeError):
        return scanned, True
    return scanned, False


def _artifact_files(paths: Sequence[Path]) -> list[Path]:
    files: set[Path] = set()
    for raw_path in paths:
        path = raw_path.expanduser().resolve()
        if not path.exists() or path.is_symlink():
            raise CommunityReleaseGateError("Artifact scan input is invalid.")
        if path.is_file():
            files.add(path)
            continue
        if not path.is_dir():
            raise CommunityReleaseGateError("Artifact scan input is invalid.")
        for child in path.rglob("*"):
            if child.is_symlink():
                raise CommunityReleaseGateError("Artifact scan input is invalid.")
            if child.is_file():
                files.add(child.resolve())
    return sorted(files, key=lambda item: str(item).casefold())


def scan_artifacts(paths: Sequence[Path]) -> ReleaseGateSummary:
    """Reject private canaries and credential markers without echoing their values."""

    if not paths:
        raise CommunityReleaseGateError("At least one artifact path is required.")
    files = _artifact_files(paths)
    scanned_units = 0
    finding_files = 0
    for path in files:
        scanned_units += 1
        if _contains_private_marker(path.name.encode("utf-8", errors="ignore")):
            finding_files += 1
            continue
        if zipfile.is_zipfile(path):
            archive_units, found = _scan_zip_archive(path)
            scanned_units += archive_units
            if found:
                finding_files += 1
            continue
        try:
            with path.open("rb") as artifact:
                if _stream_contains_private_marker(artifact):
                    finding_files += 1
        except OSError as error:
            raise CommunityReleaseGateError("An artifact could not be scanned.") from error
    if finding_files:
        raise CommunityReleaseGateError(
            f"Artifact privacy scan failed for {finding_files} file(s)."
        )
    return {
        "version": MANIFEST_VERSION,
        "checks": [
            {"name": "artifact_files_scanned", "count": scanned_units},
            {"name": "artifact_privacy_findings", "count": 0},
        ],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verify the isolated RCP-32 release gate.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "stage-demo-activity",
        help="Stage deterministic legacy Demo Cook activity in the primary database.",
    )
    verify_parser = commands.add_parser("verify", help="Verify database evidence.")
    verify_parser.add_argument("--manifest", required=True, type=Path)
    scan_parser = commands.add_parser(
        "scan-artifacts",
        help="Reject private acceptance values in files or directories.",
    )
    scan_parser.add_argument("paths", nargs="+", type=Path)
    return parser


def _create_release_gate_engine(database_url: str) -> Engine:
    return create_engine(
        database_url,
        pool_pre_ping=True,
        hide_parameters=True,
    )


def _stage_demo_activity_command() -> ReleaseGateSummary:
    database_url = validate_stage_demo_environment(os.environ)
    engine = _create_release_gate_engine(database_url)
    try:
        with Session(bind=engine) as session, session.begin():
            return stage_demo_activity(session)
    finally:
        engine.dispose()


def _verify_command(manifest_path: Path) -> ReleaseGateSummary:
    database_url = validate_release_gate_environment(os.environ)
    manifest = load_manifest(manifest_path)
    engine = _create_release_gate_engine(database_url)
    try:
        with engine.connect() as connection, connection.begin():
            connection.execute(text("SET TRANSACTION READ ONLY"))
            with Session(bind=connection) as session:
                return verify_release_gate(session, manifest)
    finally:
        engine.dispose()


def main(argv: Sequence[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    try:
        if arguments.command == "verify":
            summary = _verify_command(cast(Path, arguments.manifest))
        elif arguments.command == "stage-demo-activity":
            summary = _stage_demo_activity_command()
        else:
            summary = scan_artifacts(cast(list[Path], arguments.paths))
    except CommunityReleaseGateError as error:
        raise SystemExit(f"RCP-32 release gate refused: {error}") from None
    except (SQLAlchemyError, OSError):
        raise SystemExit(
            "RCP-32 release gate could not complete; private database diagnostics were withheld."
        ) from None
    print(render_summary(summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
