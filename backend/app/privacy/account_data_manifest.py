"""Reviewed account-data inventory for lifecycle and retention work.

This module is intentionally static.  It documents policy; it does not inspect the
database at runtime, generate SQL, or execute account deletion.  Tests compare these
reviewed literals with SQLAlchemy metadata so a schema change requires a conscious
governance review.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

MANIFEST_SCHEMA_VERSION: Final[str] = "1"
MANIFEST_REVIEW_REFERENCE: Final[str] = "RCP-33E / GitHub issue #93"


class DataDisposition(StrEnum):
    """Allowed outcomes for account-linked data."""

    DELETE = "delete"
    ANONYMIZE = "anonymize"
    RETAIN = "retain"
    PROHIBIT = "prohibit"


class ArtifactKind(StrEnum):
    """Non-database storage surfaces that need an explicit policy."""

    BROWSER_STORAGE = "browser_storage"
    EXTERNAL_IDENTITY = "external_identity"
    LOG = "log"
    DATABASE_RESIDUE = "database_residue"
    BACKUP = "backup"
    FILE = "file"
    CACHE = "cache"
    DERIVED_ARTIFACT = "derived_artifact"
    RESEARCH_DATA = "research_data"


@dataclass(frozen=True)
class ColumnPolicy:
    """One non-overlapping field group with a single permitted outcome."""

    columns: tuple[str, ...]
    disposition: DataDisposition
    rationale: str


@dataclass(frozen=True)
class RowPolicy:
    """Conditional row handling without weakening field classification."""

    case: str
    disposition: DataDisposition
    selector: str
    timing: str
    rationale: str


@dataclass(frozen=True)
class DatabaseTablePolicy:
    """Static classification of one recursively account-linked ORM table."""

    table: str
    columns: tuple[str, ...]
    foreign_keys: tuple[str, ...]
    relationships: tuple[str, ...]
    column_policies: tuple[ColumnPolicy, ...]
    row_policies: tuple[RowPolicy, ...]
    scope: str
    rationale: str
    embedded_content_columns: tuple[str, ...] = ()


@dataclass(frozen=True)
class ArtifactPolicy:
    """Policy for account data outside the primary SQLAlchemy schema."""

    key: str
    kind: ArtifactKind
    locations: tuple[str, ...]
    account_data: str
    disposition: DataDisposition
    timing: str
    required_control: str
    rationale: str


def _columns(value: str) -> tuple[str, ...]:
    return tuple(value.split())


def _column_policy(
    columns: str,
    disposition: DataDisposition,
    rationale: str,
) -> ColumnPolicy:
    return ColumnPolicy(
        columns=_columns(columns),
        disposition=disposition,
        rationale=rationale,
    )


def _row_policy(
    case: str,
    disposition: DataDisposition,
    selector: str,
    timing: str,
    rationale: str,
) -> RowPolicy:
    return RowPolicy(
        case=case,
        disposition=disposition,
        selector=selector,
        timing=timing,
        rationale=rationale,
    )


def _table(
    table: str,
    columns: str,
    *,
    foreign_keys: tuple[str, ...] = (),
    relationships: tuple[str, ...] = (),
    column_disposition: DataDisposition | None = None,
    column_policies: tuple[ColumnPolicy, ...] = (),
    row_policies: tuple[RowPolicy, ...] = (),
    scope: str,
    rationale: str,
    embedded_content_columns: str = "",
) -> DatabaseTablePolicy:
    reviewed_columns = _columns(columns)
    if (column_disposition is None) == (not column_policies):
        raise ValueError(
            "Each table needs either one all-column disposition or explicit column policies."
        )
    reviewed_column_policies = column_policies
    if column_disposition is not None:
        reviewed_column_policies = (
            ColumnPolicy(
                columns=reviewed_columns,
                disposition=column_disposition,
                rationale=rationale,
            ),
        )
    return DatabaseTablePolicy(
        table=table,
        columns=reviewed_columns,
        foreign_keys=foreign_keys,
        relationships=relationships,
        column_policies=reviewed_column_policies,
        row_policies=row_policies,
        scope=scope,
        rationale=rationale,
        embedded_content_columns=_columns(embedded_content_columns),
    )


DATABASE_TABLE_POLICIES: Final[tuple[DatabaseTablePolicy, ...]] = (
    _table(
        "user_follows",
        "follower_user_id followed_user_id created_at",
        foreign_keys=(
            "user_follows(followed_user_id)->users(id)",
            "user_follows(follower_user_id)->users(id)",
        ),
        column_disposition=DataDisposition.DELETE,
        row_policies=(
            _row_policy(
                "deleted member follows another cook",
                DataDisposition.DELETE,
                "follower_user_id equals the deleted user id",
                "Inside the account-deletion transaction.",
                "A deleted account cannot retain a social relationship.",
            ),
            _row_policy(
                "another member follows the deleted cook",
                DataDisposition.DELETE,
                "followed_user_id equals the deleted user id",
                "Inside the account-deletion transaction.",
                "Followers should not remain attached to a deleted profile.",
            ),
        ),
        scope="Delete every incoming and outgoing follow involving the deleted member.",
        rationale="Follow relationships are private account state with no retained audit use.",
    ),
    _table(
        "abuse_rate_limit_buckets",
        "operation dimension subject_digest account_user_id window_started_at request_count "
        "expires_at",
        foreign_keys=("abuse_rate_limit_buckets(account_user_id)->users(id)",),
        column_disposition=DataDisposition.DELETE,
        row_policies=(
            _row_policy(
                "member-account bucket",
                DataDisposition.DELETE,
                "account_user_id equals the deleted user id",
                "Inside the account-deletion transaction.",
                "The bucket is directly bound to the deleted account.",
            ),
            _row_policy(
                "identity or network bucket",
                DataDisposition.RETAIN,
                "account_user_id is null",
                "Only until expires_at, followed by bounded cleanup.",
                "Pseudonymous anti-abuse state is not an account record.",
            ),
        ),
        scope=(
            "Delete rows keyed to the deleted account immediately; identity and network rows "
            "are pseudonymous abuse controls and expire at their bounded TTL."
        ),
        rationale="Prevents account access while preserving short-lived anti-abuse protection.",
        embedded_content_columns="subject_digest",
    ),
    _table(
        "catalog_curators",
        "user_id granted_by_user_id created_at",
        foreign_keys=(
            "catalog_curators(granted_by_user_id)->users(id)",
            "catalog_curators(user_id)->users(id)",
        ),
        relationships=(
            "catalog_curators.granted_by_user->users",
            "catalog_curators.user->users",
        ),
        column_policies=(
            _column_policy(
                "user_id",
                DataDisposition.DELETE,
                "Role membership ends when the role holder deletes their account.",
            ),
            _column_policy(
                "granted_by_user_id created_at",
                DataDisposition.RETAIN,
                "Grant audit attribution remains attached to another member's active role.",
            ),
        ),
        row_policies=(
            _row_policy(
                "deleted member holds role",
                DataDisposition.DELETE,
                "user_id equals the deleted user id",
                "Inside the account-deletion transaction.",
                "Deleted accounts cannot retain curator authority.",
            ),
            _row_policy(
                "deleted member granted another role",
                DataDisposition.RETAIN,
                "granted_by_user_id equals the deleted user id and user_id does not",
                "For the life of the grantee's role audit row.",
                "The stable tombstone preserves who performed the grant.",
            ),
        ),
        scope=(
            "Delete the role row when user_id is the deleted member; retain granted_by_user_id "
            "only as stable tombstone audit attribution on another member's grant."
        ),
        rationale="Revocation is immediate while governance history remains attributable.",
    ),
    _table(
        "community_moderators",
        "user_id granted_by_user_id created_at",
        foreign_keys=(
            "community_moderators(granted_by_user_id)->users(id)",
            "community_moderators(user_id)->users(id)",
        ),
        relationships=(
            "community_moderators.granted_by_user->users",
            "community_moderators.user->users",
        ),
        column_policies=(
            _column_policy(
                "user_id",
                DataDisposition.DELETE,
                "Role membership ends when the role holder deletes their account.",
            ),
            _column_policy(
                "granted_by_user_id created_at",
                DataDisposition.RETAIN,
                "Grant audit attribution remains attached to another member's active role.",
            ),
        ),
        row_policies=(
            _row_policy(
                "deleted member holds role",
                DataDisposition.DELETE,
                "user_id equals the deleted user id",
                "Inside the account-deletion transaction.",
                "Deleted accounts cannot retain moderator authority.",
            ),
            _row_policy(
                "deleted member granted another role",
                DataDisposition.RETAIN,
                "granted_by_user_id equals the deleted user id and user_id does not",
                "For the life of the grantee's role audit row.",
                "The stable tombstone preserves who performed the grant.",
            ),
        ),
        scope=(
            "Delete the role row when user_id is the deleted member; retain granted_by_user_id "
            "only as stable tombstone audit attribution on another member's grant."
        ),
        rationale="Revocation is immediate while moderation grant history remains attributable.",
    ),
    _table(
        "ingredient_catalog_audit_events",
        "request_id actor_user_id event_type payload id created_at",
        foreign_keys=(
            "ingredient_catalog_audit_events(actor_user_id)->users(id)",
            "ingredient_catalog_audit_events(request_id)->ingredient_catalog_requests(id)",
        ),
        relationships=(
            "ingredient_catalog_audit_events.actor->users",
            "ingredient_catalog_audit_events.request->ingredient_catalog_requests",
        ),
        column_policies=(
            _column_policy(
                "payload",
                DataDisposition.ANONYMIZE,
                "Remove member-supplied context from retained submitted-event JSON.",
            ),
            _column_policy(
                "request_id actor_user_id event_type id created_at",
                DataDisposition.RETAIN,
                "Terminal governance history and stable tombstone attribution remain auditable.",
            ),
        ),
        row_policies=(
            _row_policy(
                "pending request event",
                DataDisposition.DELETE,
                "request_id identifies a pending request submitted by the deleted member",
                "Inside the account-deletion transaction.",
                "No catalog decision depends on an unresolved submission.",
            ),
            _row_policy(
                "terminal request event",
                DataDisposition.RETAIN,
                "request_id identifies an approved, rejected, or duplicate request",
                "Retain with catalog governance history after payload context is anonymized.",
                "The terminal decision must remain reproducible.",
            ),
        ),
        scope=(
            "Delete events for the member's pending request. Retain terminal governance events "
            "but remove submitted free-text context and resolve actors through the user tombstone."
        ),
        rationale=(
            "Approved catalog provenance is public governance evidence, not private draft data."
        ),
        embedded_content_columns="payload",
    ),
    _table(
        "ingredient_catalog_requests",
        "requester_user_id proposed_name normalized_name normalized_name_digest context status "
        "reviewer_user_id reviewed_at decision_reason resolved_ingredient_id "
        "duplicate_of_request_id approved_canonical_name approved_aliases approval_provenance id "
        "created_at updated_at",
        foreign_keys=(
            "ingredient_catalog_requests(duplicate_of_request_id)->ingredient_catalog_requests(id)",
            "ingredient_catalog_requests(requester_user_id)->users(id)",
            "ingredient_catalog_requests(resolved_ingredient_id)->ingredients(id)",
            "ingredient_catalog_requests(reviewer_user_id)->users(id)",
        ),
        relationships=(
            "ingredient_catalog_requests.duplicate_of_request->ingredient_catalog_requests",
            "ingredient_catalog_requests.requester->users",
            "ingredient_catalog_requests.resolved_ingredient->ingredients",
            "ingredient_catalog_requests.reviewer->users",
        ),
        column_policies=(
            _column_policy(
                "context",
                DataDisposition.ANONYMIZE,
                "Remove requester-supplied free-text context from retained terminal decisions.",
            ),
            _column_policy(
                "requester_user_id proposed_name normalized_name normalized_name_digest status "
                "reviewer_user_id reviewed_at decision_reason resolved_ingredient_id "
                "duplicate_of_request_id approved_canonical_name approved_aliases "
                "approval_provenance id created_at updated_at",
                DataDisposition.RETAIN,
                "Terminal catalog decisions and their stable tombstone attribution remain "
                "auditable.",
            ),
        ),
        row_policies=(
            _row_policy(
                "pending request",
                DataDisposition.DELETE,
                "requester_user_id equals the deleted user id and status is pending",
                "Inside the account-deletion transaction.",
                "No terminal catalog decision depends on the unresolved submission.",
            ),
            _row_policy(
                "terminal request",
                DataDisposition.RETAIN,
                "requester_user_id equals the deleted user id and status is terminal",
                "Retain after the context field and submitted-event context are anonymized.",
                "Catalog provenance protects the curated vocabulary.",
            ),
        ),
        scope=(
            "Delete pending submissions. Retain approved, rejected, and duplicate decisions and "
            "their catalog topology, remove requester context, and resolve user references through "
            "stable tombstones."
        ),
        rationale="Terminal catalog decisions must remain reproducible without private context.",
        embedded_content_columns=(
            "proposed_name normalized_name normalized_name_digest context decision_reason "
            "approved_canonical_name approved_aliases approval_provenance"
        ),
    ),
    _table(
        "oidc_identities",
        "user_id issuer subject email email_verified last_seen_at id created_at",
        foreign_keys=("oidc_identities(user_id)->users(id)",),
        relationships=("oidc_identities.user->users",),
        column_disposition=DataDisposition.DELETE,
        scope=(
            "Delete every local provider-identity mapping for the member in the deletion "
            "transaction."
        ),
        rationale=(
            "Issuer, subject, and email are authentication identity data with no retained use."
        ),
        embedded_content_columns="issuer subject email",
    ),
    _table(
        "oidc_login_transactions",
        "state_digest nonce pkce_verifier return_path purpose bound_session_id expires_at "
        "consumed_at "
        "id created_at",
        foreign_keys=("oidc_login_transactions(bound_session_id)->user_sessions(id)",),
        column_disposition=DataDisposition.DELETE,
        row_policies=(
            _row_policy(
                "transaction bound to a deleted session",
                DataDisposition.DELETE,
                "bound_session_id belongs to a session for the deleted user",
                "Through the session foreign-key cascade in the deletion transaction.",
                "The authentication secret is reachable from the deleted account.",
            ),
            _row_policy(
                "unbound or anonymous transaction",
                DataDisposition.RETAIN,
                "bound_session_id is null or belongs to another account",
                "Only until expires_at or consumption cleanup.",
                "It is not account data for the member being deleted.",
            ),
        ),
        scope=(
            "Delete transactions bound to a deleted session through the session cascade; all "
            "unbound "
            "or anonymous login transactions expire or are purged after consumption."
        ),
        rationale="These are short-lived authentication secrets, never durable account history.",
        embedded_content_columns="state_digest nonce pkce_verifier return_path",
    ),
    _table(
        "preference_events",
        "id action_id user_id recipe_version_id event_type saved_value rating_value "
        "related_recipe_version_id request_fingerprint occurred_at",
        foreign_keys=(
            "preference_events(recipe_version_id)->recipe_versions(id)",
            "preference_events(related_recipe_version_id)->recipe_versions(id)",
            "preference_events(user_id)->users(id)",
        ),
        column_disposition=DataDisposition.DELETE,
        scope="Delete every event emitted by the member, including idempotency fingerprints.",
        rationale=(
            "Behavioral signals are private account state and are not needed for public topology."
        ),
        embedded_content_columns="request_fingerprint",
    ),
    _table(
        "recipe_draft_categories",
        "recipe_draft_id recipe_category_id display_order",
        foreign_keys=(
            "recipe_draft_categories(recipe_category_id)->recipe_categories(id)",
            "recipe_draft_categories(recipe_draft_id)->recipe_drafts(id)",
        ),
        relationships=(
            "recipe_draft_categories.category->recipe_categories",
            "recipe_draft_categories.draft->recipe_drafts",
        ),
        column_disposition=DataDisposition.DELETE,
        scope="Delete every category selection attached to a member-owned private draft.",
        rationale="Draft discovery labels remain private authoring state until publication.",
    ),
    _table(
        "recipe_draft_ingredients",
        "recipe_draft_id selection_kind ingredient_id ingredient_request_id name measure_mode "
        "quantity_min quantity_max measurement_unit_id unit_display package_size_id "
        "preparation_notes display_order id",
        foreign_keys=(
            "recipe_draft_ingredients(ingredient_id)->ingredients(id)",
            "recipe_draft_ingredients(ingredient_request_id)->ingredient_catalog_requests(id)",
            "recipe_draft_ingredients(measurement_unit_id)->measurement_units(id)",
            "recipe_draft_ingredients(package_size_id,ingredient_id,measurement_unit_id)"
            "->ingredient_package_sizes(id,ingredient_id,package_unit_id)",
            "recipe_draft_ingredients(recipe_draft_id)->recipe_drafts(id)",
        ),
        relationships=(
            "recipe_draft_ingredients.draft->recipe_drafts",
            "recipe_draft_ingredients.ingredient->ingredients",
            "recipe_draft_ingredients.ingredient_request->ingredient_catalog_requests",
            "recipe_draft_ingredients.measurement_unit->measurement_units",
            "recipe_draft_ingredients.package_size->ingredient_package_sizes",
        ),
        column_disposition=DataDisposition.DELETE,
        scope="Delete all ingredient rows for every draft owned by the member.",
        rationale="Draft ingredient choices and notes are private authoring state.",
        embedded_content_columns="name unit_display preparation_notes",
    ),
    _table(
        "recipe_draft_instruction_action_inputs",
        "recipe_draft_id recipe_draft_instruction_action_id recipe_draft_ingredient_id "
        "display_order id",
        foreign_keys=(
            "recipe_draft_instruction_action_inputs(recipe_draft_id,recipe_draft_ingredient_id)"
            "->recipe_draft_ingredients(recipe_draft_id,id)",
            "recipe_draft_instruction_action_inputs(recipe_draft_id,recipe_draft_instruction_action_id)"
            "->recipe_draft_instruction_actions(recipe_draft_id,id)",
        ),
        relationships=(
            "recipe_draft_instruction_action_inputs.action->recipe_draft_instruction_actions",
            "recipe_draft_instruction_action_inputs.ingredient->recipe_draft_ingredients",
        ),
        column_disposition=DataDisposition.DELETE,
        scope="Delete with the member's structured draft instruction graph.",
        rationale="Input ordering is private draft structure.",
    ),
    _table(
        "recipe_draft_instruction_action_measures",
        "recipe_draft_instruction_action_id semantic measure_mode quantity_min quantity_max "
        "measurement_unit_id unit_display",
        foreign_keys=(
            "recipe_draft_instruction_action_measures(measurement_unit_id)->measurement_units(id)",
            "recipe_draft_instruction_action_measures(recipe_draft_instruction_action_id)"
            "->recipe_draft_instruction_actions(id)",
        ),
        relationships=(
            "recipe_draft_instruction_action_measures.action->recipe_draft_instruction_actions",
            "recipe_draft_instruction_action_measures.measurement_unit->measurement_units",
        ),
        column_disposition=DataDisposition.DELETE,
        scope="Delete with the member's structured draft instruction graph.",
        rationale="Action measurements are private draft structure.",
        embedded_content_columns="unit_display",
    ),
    _table(
        "recipe_draft_instruction_actions",
        "recipe_draft_id recipe_draft_instruction_id action_type_id display_order id",
        foreign_keys=(
            "recipe_draft_instruction_actions(action_type_id)->cooking_action_types(id)",
            "recipe_draft_instruction_actions(recipe_draft_id,recipe_draft_instruction_id)"
            "->recipe_draft_instructions(recipe_draft_id,id)",
        ),
        relationships=(
            "recipe_draft_instruction_actions.action_type->cooking_action_types",
            "recipe_draft_instruction_actions.inputs->recipe_draft_instruction_action_inputs",
            "recipe_draft_instruction_actions.instruction->recipe_draft_instructions",
            "recipe_draft_instruction_actions.measures->recipe_draft_instruction_action_measures",
        ),
        column_disposition=DataDisposition.DELETE,
        scope="Delete with the member's structured draft instruction graph.",
        rationale="Action order and type are private draft structure.",
    ),
    _table(
        "recipe_draft_instructions",
        "recipe_draft_id title instruction display_order id",
        foreign_keys=("recipe_draft_instructions(recipe_draft_id)->recipe_drafts(id)",),
        relationships=(
            "recipe_draft_instructions.actions->recipe_draft_instruction_actions",
            "recipe_draft_instructions.draft->recipe_drafts",
        ),
        column_disposition=DataDisposition.DELETE,
        scope="Delete every instruction row for every draft owned by the member.",
        rationale=(
            "Human-readable instructions are private until publication creates a version copy."
        ),
        embedded_content_columns="title instruction",
    ),
    _table(
        "recipe_drafts",
        "author_user_id source_version_id creation_action_id creation_request_fingerprint status "
        "revision title description servings total_time_minutes active_time_minutes difficulty "
        "notes id created_at updated_at",
        foreign_keys=(
            "recipe_drafts(author_user_id)->users(id)",
            "recipe_drafts(source_version_id)->recipe_versions(id)",
        ),
        relationships=(
            "recipe_drafts.author->users",
            "recipe_drafts.categories->recipe_draft_categories",
            "recipe_drafts.ingredients->recipe_draft_ingredients",
            "recipe_drafts.instructions->recipe_draft_instructions",
            "recipe_drafts.publication->recipe_version_publications",
            "recipe_drafts.source_version->recipe_versions",
        ),
        column_policies=(
            _column_policy(
                "title description servings total_time_minutes active_time_minutes difficulty "
                "notes",
                DataDisposition.ANONYMIZE,
                "Erase private draft content from the published source shell.",
            ),
            _column_policy(
                "author_user_id source_version_id creation_action_id "
                "creation_request_fingerprint status revision id created_at updated_at",
                DataDisposition.RETAIN,
                "A content-free published shell preserves bounded creation/publication "
                "idempotency and topology.",
            ),
        ),
        row_policies=(
            _row_policy(
                "active or discarded draft shell",
                DataDisposition.DELETE,
                "author_user_id equals the deleted user id and status is active or discarded",
                "Inside the account-deletion transaction.",
                "Unpublished authoring state and its terminal retry binding have no public "
                "retention purpose after account deletion.",
            ),
            _row_policy(
                "published source draft",
                DataDisposition.ANONYMIZE,
                "author_user_id equals the deleted user id and status is published",
                "Inside the account-deletion transaction.",
                "Keep only the content-free shell required by publication constraints.",
            ),
        ),
        scope=(
            "Delete active drafts and discarded shells. Retain a content-free published shell "
            "only where publication idempotency and source linkage require it; erase title, "
            "description, servings, cooking times, difficulty, and notes."
        ),
        rationale="Private work is erased while immutable publication topology stays valid.",
        embedded_content_columns="title description notes",
    ),
    _table(
        "recipe_duplicate_candidates",
        "preflight_id public_recipe_version_id rank classification score_basis_points reason_codes "
        "fingerprint_algorithm_version policy_version exact_payload_confirmed",
        foreign_keys=(
            "recipe_duplicate_candidates(preflight_id,policy_version,fingerprint_algorithm_version)"
            "->recipe_duplicate_preflights(id,policy_version,subject_fingerprint_algorithm)",
            "recipe_duplicate_candidates(public_recipe_version_id)->recipe_versions(id)",
        ),
        relationships=(
            "recipe_duplicate_candidates.preflight->recipe_duplicate_preflights",
            "recipe_duplicate_candidates.public_recipe_version->recipe_versions",
        ),
        column_disposition=DataDisposition.RETAIN,
        row_policies=(
            _row_policy(
                "unpublished candidate",
                DataDisposition.DELETE,
                "preflight_id is not referenced by a publication",
                "Inside the account-deletion transaction.",
                "Private similarity-review evidence has no durable purpose.",
            ),
            _row_policy(
                "publication-bound candidate",
                DataDisposition.RETAIN,
                "preflight_id is referenced by a publication",
                "For the life of the immutable publication audit record.",
                "The public decision must remain reproducible.",
            ),
        ),
        scope=(
            "Delete candidates belonging to an unpublished private preflight; retain candidates "
            "bound to a publication decision as reproducible public-policy evidence."
        ),
        rationale="Candidate evidence is private until incorporated into an immutable publication.",
        embedded_content_columns="reason_codes",
    ),
    _table(
        "recipe_duplicate_decisions",
        "preflight_id actor_user_id action_id decision acknowledged_policy_version "
        "acknowledged_result_digest id created_at",
        foreign_keys=(
            "recipe_duplicate_decisions(actor_user_id)->users(id)",
            "recipe_duplicate_decisions(preflight_id,actor_user_id,acknowledged_policy_version,"
            "acknowledged_result_digest)->recipe_duplicate_preflights(id,actor_user_id,"
            "policy_version,result_digest)",
        ),
        relationships=(
            "recipe_duplicate_decisions.actor->users",
            "recipe_duplicate_decisions.preflight->recipe_duplicate_preflights",
        ),
        column_disposition=DataDisposition.RETAIN,
        row_policies=(
            _row_policy(
                "unpublished decision",
                DataDisposition.DELETE,
                "preflight_id is not referenced by a publication",
                "Inside the account-deletion transaction.",
                "Private similarity-review decisions have no durable purpose.",
            ),
            _row_policy(
                "publication-bound decision",
                DataDisposition.RETAIN,
                "id is referenced by a publication",
                "For the life of the immutable publication audit record.",
                "Stable tombstone attribution preserves the public acknowledgement.",
            ),
        ),
        scope=(
            "Delete decisions for unpublished private preflights; retain publication-bound "
            "decisions "
            "and resolve the actor through the stable user tombstone."
        ),
        rationale="A published duplicate acknowledgement is required audit evidence.",
        embedded_content_columns="acknowledged_result_digest",
    ),
    _table(
        "recipe_duplicate_preflights",
        "actor_user_id action_id request_fingerprint source_version_id "
        "subject_fingerprint_algorithm subject_fingerprint_digest policy_version classification "
        "same_parent_no_change result_digest "
        "id created_at",
        foreign_keys=(
            "recipe_duplicate_preflights(actor_user_id)->users(id)",
            "recipe_duplicate_preflights(source_version_id)->recipe_versions(id)",
        ),
        relationships=(
            "recipe_duplicate_preflights.actor->users",
            "recipe_duplicate_preflights.candidates->recipe_duplicate_candidates",
            "recipe_duplicate_preflights.decision->recipe_duplicate_decisions",
            "recipe_duplicate_preflights.source_version->recipe_versions",
        ),
        column_disposition=DataDisposition.RETAIN,
        row_policies=(
            _row_policy(
                "unpublished preflight",
                DataDisposition.DELETE,
                "id is not referenced by a publication",
                "Inside the account-deletion transaction.",
                "Private similarity-review evidence has no durable purpose.",
            ),
            _row_policy(
                "publication-bound preflight",
                DataDisposition.RETAIN,
                "id is referenced by a publication",
                "For the life of the immutable publication audit record.",
                "The public duplicate-policy result must remain reproducible.",
            ),
        ),
        scope=(
            "Delete unpublished private preflights and their graph; retain publication-bound "
            "preflights and stable actor attribution for reproducibility."
        ),
        rationale=(
            "Only duplicate evidence incorporated into a public version has a durable purpose."
        ),
        embedded_content_columns=("request_fingerprint subject_fingerprint_digest result_digest"),
    ),
    _table(
        "recipe_instruction_action_inputs",
        "recipe_version_id recipe_instruction_action_id recipe_ingredient_id display_order id",
        foreign_keys=(
            "recipe_instruction_action_inputs(recipe_version_id,recipe_ingredient_id)"
            "->recipe_version_ingredients(recipe_version_id,id)",
            "recipe_instruction_action_inputs(recipe_version_id,recipe_instruction_action_id)"
            "->recipe_instruction_actions(recipe_version_id,id)",
        ),
        relationships=(
            "recipe_instruction_action_inputs.action->recipe_instruction_actions",
            "recipe_instruction_action_inputs.ingredient->recipe_version_ingredients",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain as part of an immutable public recipe version's structured action graph.",
        rationale=(
            "Published recipe structure is community content and duplicate-detection evidence."
        ),
    ),
    _table(
        "recipe_instruction_action_measures",
        "recipe_instruction_action_id semantic measure_mode quantity_min quantity_max "
        "measurement_unit_id unit_display",
        foreign_keys=(
            "recipe_instruction_action_measures(measurement_unit_id)->measurement_units(id)",
            "recipe_instruction_action_measures(recipe_instruction_action_id)"
            "->recipe_instruction_actions(id)",
        ),
        relationships=(
            "recipe_instruction_action_measures.action->recipe_instruction_actions",
            "recipe_instruction_action_measures.measurement_unit->measurement_units",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain as part of an immutable public recipe version's structured action graph.",
        rationale="Published measurements are community content and structural evidence.",
        embedded_content_columns="unit_display",
    ),
    _table(
        "recipe_instruction_actions",
        "recipe_version_id recipe_instruction_id action_type_id display_order id",
        foreign_keys=(
            "recipe_instruction_actions(action_type_id)->cooking_action_types(id)",
            "recipe_instruction_actions(recipe_version_id,recipe_instruction_id)"
            "->recipe_version_instructions(recipe_version_id,id)",
        ),
        relationships=(
            "recipe_instruction_actions.action_type->cooking_action_types",
            "recipe_instruction_actions.inputs->recipe_instruction_action_inputs",
            "recipe_instruction_actions.instruction->recipe_version_instructions",
            "recipe_instruction_actions.measures->recipe_instruction_action_measures",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain as part of an immutable public recipe version's structured action graph.",
        rationale="Published action order is community content and structural evidence.",
    ),
    _table(
        "recipe_lineages",
        "created_by_user_id id created_at",
        foreign_keys=("recipe_lineages(created_by_user_id)->users(id)",),
        relationships=("recipe_lineages.versions->recipe_versions",),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain lineage identity and stable tombstone attribution for published versions.",
        rationale="Deleting a lineage would break public version and fork topology.",
    ),
    _table(
        "recipe_moderation_audit_events",
        "id recipe_version_id actor_user_id action previous_status status visibility_state "
        "private_note action_id request_fingerprint occurred_at",
        foreign_keys=(
            "recipe_moderation_audit_events(actor_user_id)->users(id)",
            "recipe_moderation_audit_events(recipe_version_id)"
            "->recipe_moderation_cases(recipe_version_id)",
        ),
        relationships=(
            "recipe_moderation_audit_events.actor->users",
            "recipe_moderation_audit_events.moderation_case->recipe_moderation_cases",
        ),
        column_policies=(
            _column_policy(
                "private_note request_fingerprint",
                DataDisposition.ANONYMIZE,
                "Erase private operator prose and replace identity hashes with a fixed digest.",
            ),
            _column_policy(
                "id recipe_version_id actor_user_id action previous_status status visibility_state "
                "action_id occurred_at",
                DataDisposition.RETAIN,
                "Append-only moderation history and stable tombstone attribution remain auditable.",
            ),
        ),
        scope=(
            "Retain append-only moderation state and stable actor tombstone attribution; erase "
            "private "
            "notes and replace request fingerprints with the fixed deleted-account digest."
        ),
        rationale=(
            "Moderation accountability remains while private operator text and identity hashes "
            "do not."
        ),
        embedded_content_columns="private_note request_fingerprint",
    ),
    _table(
        "recipe_moderation_cases",
        "recipe_version_id status opened_at resolved_at reporter_count last_reported_at updated_at",
        foreign_keys=(
            "recipe_moderation_cases(recipe_version_id)"
            "->recipe_version_publications(recipe_version_id)",
        ),
        relationships=(
            "recipe_moderation_cases.audit_events->recipe_moderation_audit_events",
            "recipe_moderation_cases.publication->recipe_version_publications",
            "recipe_moderation_cases.reports->recipe_reports",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain case state and aggregate reporter counts for published-recipe governance.",
        rationale=(
            "Case state contains no reporter identity and protects community moderation history."
        ),
    ),
    _table(
        "recipe_ratings",
        "user_id recipe_version_id rating created_at",
        foreign_keys=(
            "recipe_ratings(recipe_version_id)->recipe_versions(id)",
            "recipe_ratings(user_id)->users(id)",
        ),
        relationships=("recipe_ratings.recipe_version->recipe_versions",),
        column_disposition=DataDisposition.DELETE,
        scope="Delete every rating made by the member.",
        rationale="A member's ratings are private preference state and recommendation signals.",
    ),
    _table(
        "recipe_reports",
        "recipe_version_id reporter_user_id reason details action_id request_fingerprint id "
        "created_at",
        foreign_keys=(
            "recipe_reports(recipe_version_id)->recipe_moderation_cases(recipe_version_id)",
            "recipe_reports(reporter_user_id)->users(id)",
        ),
        relationships=(
            "recipe_reports.moderation_case->recipe_moderation_cases",
            "recipe_reports.reporter->users",
        ),
        column_policies=(
            _column_policy(
                "details request_fingerprint",
                DataDisposition.ANONYMIZE,
                "Erase private reporter prose and replace identity hashes with a fixed digest.",
            ),
            _column_policy(
                "recipe_version_id reporter_user_id reason action_id id created_at",
                DataDisposition.RETAIN,
                "Case linkage, reason, and stable tombstone attribution preserve moderation "
                "history.",
            ),
        ),
        scope=(
            "Retain reason, case linkage, and stable reporter tombstone attribution; erase report "
            "details and replace request fingerprints with the fixed deleted-account digest."
        ),
        rationale=(
            "Moderation counts and reasons remain valid without private prose or request identity."
        ),
        embedded_content_columns="details request_fingerprint",
    ),
    _table(
        "recipe_saves",
        "user_id recipe_version_id created_at",
        foreign_keys=(
            "recipe_saves(recipe_version_id)->recipe_versions(id)",
            "recipe_saves(user_id)->users(id)",
        ),
        relationships=("recipe_saves.recipe_version->recipe_versions",),
        column_disposition=DataDisposition.DELETE,
        scope="Delete every save made by the member.",
        rationale="A member's saved library is private preference state.",
    ),
    _table(
        "recipe_structural_fingerprints",
        "recipe_version_id algorithm_version digest canonical_payload",
        foreign_keys=("recipe_structural_fingerprints(recipe_version_id)->recipe_versions(id)",),
        relationships=("recipe_structural_fingerprints.recipe_version->recipe_versions",),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain fingerprints only for immutable public recipe versions.",
        rationale="They derive from retained public content and enforce duplicate policy.",
        embedded_content_columns="digest canonical_payload",
    ),
    _table(
        "recipe_version_categories",
        "recipe_version_id recipe_category_id category_name category_slug display_order",
        foreign_keys=(
            "recipe_version_categories(recipe_category_id)->recipe_categories(id)",
            "recipe_version_categories(recipe_version_id)->recipe_versions(id)",
        ),
        relationships=(
            "recipe_version_categories.category->recipe_categories",
            "recipe_version_categories.recipe_version->recipe_versions",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain as an immutable public recipe category snapshot.",
        rationale=(
            "Published category identities and labels are public discovery metadata for the "
            "exact immutable version."
        ),
        embedded_content_columns="category_name category_slug",
    ),
    _table(
        "recipe_version_ingredients",
        "recipe_version_id ingredient_id name measure_mode quantity_min quantity_max "
        "measurement_unit_id unit_display package_size_id preparation_notes display_order id",
        foreign_keys=(
            "recipe_version_ingredients(ingredient_id)->ingredients(id)",
            "recipe_version_ingredients(measurement_unit_id)->measurement_units(id)",
            "recipe_version_ingredients(package_size_id,ingredient_id,measurement_unit_id)"
            "->ingredient_package_sizes(id,ingredient_id,package_unit_id)",
            "recipe_version_ingredients(recipe_version_id)->recipe_versions(id)",
        ),
        relationships=(
            "recipe_version_ingredients.ingredient->ingredients",
            "recipe_version_ingredients.measurement_unit->measurement_units",
            "recipe_version_ingredients.package_size->ingredient_package_sizes",
            "recipe_version_ingredients.recipe_version->recipe_versions",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain as immutable public recipe content.",
        rationale="Published ingredients are community content and structural evidence.",
        embedded_content_columns="name unit_display preparation_notes",
    ),
    _table(
        "recipe_version_instructions",
        "recipe_version_id title instruction display_order id",
        foreign_keys=("recipe_version_instructions(recipe_version_id)->recipe_versions(id)",),
        relationships=(
            "recipe_version_instructions.actions->recipe_instruction_actions",
            "recipe_version_instructions.recipe_version->recipe_versions",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain as immutable public recipe content.",
        rationale="Published instructions are community content and structural evidence.",
        embedded_content_columns="title instruction",
    ),
    _table(
        "recipe_version_publications",
        "recipe_version_id state author_withdrawn_at moderation_hidden_at state_changed_at "
        "state_changed_by_user_id source_draft_id actor_user_id action_id request_fingerprint "
        "draft_revision duplicate_preflight_id duplicate_policy_version duplicate_result_digest "
        "duplicate_decision_id community_rules_version publication_rights_confirmed_at "
        "published_at",
        foreign_keys=(
            "recipe_version_publications(actor_user_id)->users(id)",
            "recipe_version_publications(duplicate_decision_id,duplicate_preflight_id,actor_user_id,"
            "duplicate_policy_version,duplicate_result_digest)->recipe_duplicate_decisions(id,"
            "preflight_id,actor_user_id,acknowledged_policy_version,acknowledged_result_digest)",
            "recipe_version_publications(duplicate_preflight_id,actor_user_id,duplicate_policy_version,"
            "duplicate_result_digest)->recipe_duplicate_preflights(id,actor_user_id,policy_version,"
            "result_digest)",
            "recipe_version_publications(recipe_version_id,actor_user_id)"
            "->recipe_versions(id,created_by_user_id)",
            "recipe_version_publications(source_draft_id,actor_user_id,draft_revision)"
            "->recipe_drafts(id,author_user_id,revision)",
            "recipe_version_publications(state_changed_by_user_id)->users(id)",
        ),
        relationships=(
            "recipe_version_publications.recipe_version->recipe_versions",
            "recipe_version_publications.source_draft->recipe_drafts",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope=(
            "Retain publication, visibility, consent, idempotency, and duplicate-decision "
            "evidence; "
            "resolve account references through the stable tombstone."
        ),
        rationale=(
            "Immutable publication provenance protects authors, forks, and policy enforcement."
        ),
        embedded_content_columns="request_fingerprint duplicate_result_digest",
    ),
    _table(
        "recipe_version_visibility_events",
        "id recipe_version_id actor_user_id previous_state state author_withdrawn_at "
        "moderation_hidden_at occurred_at",
        foreign_keys=(
            "recipe_version_visibility_events(actor_user_id)->users(id)",
            "recipe_version_visibility_events(recipe_version_id)"
            "->recipe_version_publications(recipe_version_id)",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope=(
            "Retain immutable visibility history with actor references resolved through tombstones."
        ),
        rationale="Visibility transitions are required public and moderation audit evidence.",
    ),
    _table(
        "recipe_versions",
        "lineage_id parent_version_id created_by_user_id version_number title description servings "
        "total_time_minutes active_time_minutes difficulty notes id created_at",
        foreign_keys=(
            "recipe_versions(created_by_user_id)->users(id)",
            "recipe_versions(lineage_id)->recipe_lineages(id)",
            "recipe_versions(lineage_id,parent_version_id)->recipe_versions(lineage_id,id)",
        ),
        relationships=(
            "recipe_versions.author->users",
            "recipe_versions.categories->recipe_version_categories",
            "recipe_versions.descendants->recipe_versions",
            "recipe_versions.ingredients->recipe_version_ingredients",
            "recipe_versions.instructions->recipe_version_instructions",
            "recipe_versions.lineage->recipe_lineages",
            "recipe_versions.parent->recipe_versions",
            "recipe_versions.publication->recipe_version_publications",
            "recipe_versions.ratings->recipe_ratings",
            "recipe_versions.saves->recipe_saves",
            "recipe_versions.structural_fingerprints->recipe_structural_fingerprints",
        ),
        column_disposition=DataDisposition.RETAIN,
        scope="Retain immutable public versions and stable tombstone authorship.",
        rationale=(
            "Deleting a published version would break public recipes, forks, and audit topology."
        ),
        embedded_content_columns="title description notes",
    ),
    _table(
        "user_sessions",
        "user_id token_digest csrf_token_digest expires_at authenticated_at last_seen_at "
        "revoked_at "
        "id created_at",
        foreign_keys=("user_sessions(user_id)->users(id)",),
        relationships=("user_sessions.user->users",),
        column_disposition=DataDisposition.DELETE,
        scope="Lock and delete every session for the member inside the deletion transaction.",
        rationale="Session and CSRF digests have no purpose after account deletion.",
        embedded_content_columns="token_digest csrf_token_digest",
    ),
    _table(
        "users",
        "email display_name handle profile_description account_kind status deleted_at id "
        "created_at updated_at",
        column_policies=(
            _column_policy(
                "email display_name handle profile_description",
                DataDisposition.ANONYMIZE,
                "Clear identity and profile fields and replace the display name with the fixed "
                "tombstone label.",
            ),
            _column_policy(
                "account_kind status deleted_at id created_at updated_at",
                DataDisposition.RETAIN,
                "A stable non-identifying tombstone preserves foreign-key and public authorship "
                "history.",
            ),
        ),
        scope=(
            "Retain id, account kind, deleted status, deletion timestamp, and audit timestamps "
            "as a "
            "stable tombstone; clear email, handle, and profile description and replace "
            "display_name with 'Deleted cook'."
        ),
        rationale="A non-identifying tombstone preserves public authorship and audit foreign keys.",
        embedded_content_columns="email display_name handle profile_description",
    ),
)


NON_DATABASE_ARTIFACT_POLICIES: Final[tuple[ArtifactPolicy, ...]] = (
    ArtifactPolicy(
        key="browser_auth_cookies",
        kind=ArtifactKind.BROWSER_STORAGE,
        locations=("recipe_session cookie", "recipe_csrf cookie"),
        account_data="Session capability and CSRF binding held by the member's browser.",
        disposition=DataDisposition.DELETE,
        timing="Expire in the successful deletion response before control returns to the browser.",
        required_control=(
            "Set both cookies to empty values with immediate expiry and original scope."
        ),
        rationale="A deleted account must not leave reusable browser credentials.",
    ),
    ArtifactPolicy(
        key="external_oidc_provider_account",
        kind=ArtifactKind.EXTERNAL_IDENTITY,
        locations=("Configured OIDC provider, such as Amazon Cognito",),
        account_data="The provider's own account, credentials, and recovery factors.",
        disposition=DataDisposition.RETAIN,
        timing="Provider lifecycle is independent of Recipe Lab account deletion.",
        required_control=(
            "Delete every local oidc_identities mapping; clearly state that the provider account "
            "is "
            "outside Recipe Lab's control and must be managed with the provider."
        ),
        rationale="Recipe Lab cannot silently delete an identity-provider account it does not own.",
    ),
    ArtifactPolicy(
        key="raw_operational_access_logs_and_traces",
        kind=ArtifactKind.LOG,
        locations=(
            "Backend application logs",
            "Frontend/server logs",
            "Reverse-proxy and platform access logs",
            "Distributed traces and error telemetry",
        ),
        account_data="User IDs, IP addresses, request paths, query strings, and error context.",
        disposition=DataDisposition.PROHIBIT,
        timing="Disable before production traffic and reject raw request targets at every sink.",
        required_control=(
            "Disable backend access logs and require proxies and telemetry to omit raw request "
            "targets, identifiers, cookies, tokens, authorization codes, email, request bodies, "
            "report details, draft content, and query strings."
        ),
        rationale="Raw access and trace data would become an undeletable shadow account store.",
    ),
    ArtifactPolicy(
        key="allowlisted_structured_operational_events",
        kind=ArtifactKind.LOG,
        locations=(
            "Backend recipe_lab.operations logger",
            "Frontend server console/error structured-event sink",
        ),
        account_data=(
            "Backend events are authentication_failure, publication_failure, database_failure, "
            "or application_failure with only event and correlation_id. Frontend proxy events are "
            "recipe_lab.frontend.authentication_failed or "
            "recipe_lab.frontend.recipe_api_unavailable with only event, correlation_id, and "
            "status_code."
        ),
        disposition=DataDisposition.RETAIN,
        timing="Expire automatically after no more than 7 days.",
        required_control=(
            "Enforce those exact event-name and field allowlists before emission. Prohibit raw "
            "paths, route "
            "parameters, query strings, request or response bodies, headers, cookies, tokens, IP "
            "addresses, account-derived IDs, handles, email, private text, exception text, and "
            "caller-supplied labels. Correlation IDs must be application-issued random UUIDv4 "
            "values that rotate per request and never encode account or request data."
        ),
        rationale=(
            "Short-lived, low-cardinality operational outcomes support incident correlation "
            "without becoming a shadow member-activity history."
        ),
    ),
    ArtifactPolicy(
        key="deidentified_aggregate_service_metrics",
        kind=ArtifactKind.LOG,
        locations=("Reviewed aggregate metric sink",),
        account_data=(
            "Fixed metric names with bounded status, dependency, operation, and deployment labels; "
            "counts, rates, and bucketed latency only."
        ),
        disposition=DataDisposition.RETAIN,
        timing="Expire automatically after no more than 30 days.",
        required_control=(
            "Reject correlation IDs, raw paths, query strings, bodies, headers, IP addresses, "
            "account-derived IDs, handles, email, private text, unbounded labels, and "
            "caller-supplied values. Aggregate before export and enforce a minimum cohort size "
            "where a breakdown could isolate a member."
        ),
        rationale=(
            "Bounded de-identified rates and latency distributions reveal service regressions "
            "without preserving request-level or member-level histories."
        ),
    ),
    ArtifactPolicy(
        key="database_replica_wal_and_dead_rows",
        kind=ArtifactKind.DATABASE_RESIDUE,
        locations=("PostgreSQL replicas", "WAL archives", "dead tuples and storage pages"),
        account_data="Pre-deletion row images that persist below the logical database layer.",
        disposition=DataDisposition.RETAIN,
        timing="Age out through replication, WAL retention, checkpointing, and vacuum policy.",
        required_control=(
            "Keep retention bounded and access restricted; never restore or expose an old image "
            "without "
            "reapplying completed deletions before serving traffic."
        ),
        rationale="Physical erasure is asynchronous even when logical deletion is transactional.",
    ),
    ArtifactPolicy(
        key="encrypted_database_backups",
        kind=ArtifactKind.BACKUP,
        locations=("Encrypted production backups and snapshots",),
        account_data="Point-in-time copies of all account-linked database rows.",
        disposition=DataDisposition.RETAIN,
        timing="Expire no later than the documented backup-retention limit; do not extend ad hoc.",
        required_control=(
            "Restrict and audit restore access, and reapply the deletion ledger or equivalent "
            "deletion "
            "evidence before a restored database can serve users."
        ),
        rationale="Backups serve disaster recovery, not indefinite retention of deleted accounts.",
    ),
    ArtifactPolicy(
        key="durable_account_deletion_evidence",
        kind=ArtifactKind.BACKUP,
        locations=("Encrypted, access-restricted recovery ledger outside database backups",),
        account_data=(
            "Stable deleted-member UUIDs, deletion timestamps, and a coverage checkpoint. A "
            "transient SHA-256 integrity digest is reported separately and is not embedded."
        ),
        disposition=DataDisposition.RETAIN,
        timing=(
            "Replace and expire each exported ledger only after every database backup it protects "
            "has expired, within the 30-day backup maximum. Regenerated ledgers still include the "
            "full current pseudonymous tombstone set; never silently window that evidence."
        ),
        required_control=(
            "Keep the ledger encrypted and separate from database backups; restrict restore "
            "access; require an independently supplied hash and coverage cutoff; never upload "
            "ledger contents as release or CI evidence; destroy temporary replay copies; fail "
            "closed at the documented entry cap rather than truncating deletion evidence."
        ),
        rationale=(
            "A restored older backup must reapply completed deletions before it can serve traffic."
        ),
    ),
    ArtifactPolicy(
        key="observed_recommender_snapshots",
        kind=ArtifactKind.RESEARCH_DATA,
        locations=("ML observed-data JSON snapshots and researcher working copies",),
        account_data=(
            "Raw user UUIDs, preference-event UUIDs, and member-level interaction histories."
        ),
        disposition=DataDisposition.PROHIBIT,
        timing=(
            "Do not create from production or real-member data; delete disposable local research "
            "copies and their reports after the experiment."
        ),
        required_control=(
            "Require an artifact registry with member bindings, deletion propagation, and bounded "
            "expiry before enabling any managed observed-data export."
        ),
        rationale=(
            "The current offline exporter has no registry that can prove deletion across copies."
        ),
    ),
    ArtifactPolicy(
        key="aggregate_evaluation_outputs",
        kind=ArtifactKind.DERIVED_ARTIFACT,
        locations=("Offline evaluation reports", "Readiness summaries", "Aggregate metrics"),
        account_data="Counts, rates, and cohort metrics derived from member behavior.",
        disposition=DataDisposition.RETAIN,
        timing=(
            "Retain only de-identified aggregates; rebuild or remove row-level outputs promptly."
        ),
        required_control=(
            "Prohibit user IDs, event IDs, free text, and singling-out small cohorts in retained "
            "reports."
        ),
        rationale="Anonymous product evidence can remain, but member-level derived data cannot.",
    ),
    ArtifactPolicy(
        key="fitted_recommender_process_state",
        kind=ArtifactKind.CACHE,
        locations=("In-memory recommender maps, candidate sets, and request caches",),
        account_data="Transient member-to-event and member-to-preference mappings.",
        disposition=DataDisposition.PROHIBIT,
        timing="Do not create online member-level fitted state; discard local processes after use.",
        required_control=(
            "Do not serialize or deploy fitted member-level maps until invalidation and deletion "
            "are implemented and classified."
        ),
        rationale="Recipe Lab currently has no online learned-model deletion registry.",
    ),
    ArtifactPolicy(
        key="acceptance_and_test_artifacts",
        kind=ArtifactKind.FILE,
        locations=(
            "Playwright traces, screenshots, videos, downloads, and test-results",
            "Acceptance fixtures, database dumps, and session manifests",
            "CI logs and uploaded artifacts",
        ),
        account_data="Synthetic acceptance identities only; production member data is prohibited.",
        disposition=DataDisposition.PROHIBIT,
        timing="Delete local outputs after use and apply a bounded CI artifact-retention window.",
        required_control=(
            "Use deterministic synthetic accounts and secrets; never copy production databases, "
            "cookies, tokens, emails, drafts, reports, or moderation notes into tests."
        ),
        rationale="Test convenience must not create an unmanaged production-data archive.",
    ),
    ArtifactPolicy(
        key="operator_cli_and_support_exports",
        kind=ArtifactKind.FILE,
        locations=("Curator/moderator CLI output", "Support diagnostics", "Manual exports"),
        account_data=(
            "Stable user UUIDs and role/audit status; identity and session data are prohibited."
        ),
        disposition=DataDisposition.DELETE,
        timing="Keep only for the active operation; remove unmanaged copies when work completes.",
        required_control=(
            "Output only bounded UUID/status fields, never email, OIDC subject, cookies, tokens, "
            "draft "
            "content, report details, or moderation private notes."
        ),
        rationale="Operators need narrow identifiers, not a second account-data repository.",
    ),
    ArtifactPolicy(
        key="user_uploaded_files_and_derivatives",
        kind=ArtifactKind.FILE,
        locations=("Object storage", "Uploaded media", "Generated thumbnails or transcodes"),
        account_data="Member-owned binary files and storage metadata.",
        disposition=DataDisposition.PROHIBIT,
        timing=(
            "Do not accept uploads until ownership, deletion, backup, and derivative rules exist."
        ),
        required_control=(
            "A future upload feature must register every source object and derivative against its "
            "owner and prove deletion from live storage and bounded backups."
        ),
        rationale="Recipe Lab has no governed upload store in the current product.",
    ),
    ArtifactPolicy(
        key="source_and_release_packages",
        kind=ArtifactKind.FILE,
        locations=("Source archives", "Container images", "Release bundles", "dependency caches"),
        account_data="Runtime account data and production credentials are prohibited.",
        disposition=DataDisposition.PROHIBIT,
        timing="Block at build and safe-source-package gates; rotate immediately if discovered.",
        required_control=(
            "Package only reviewed source and fixtures; exclude databases, environment files, "
            "logs, "
            "screenshots, traces, snapshots, and generated runtime state."
        ),
        rationale="Deployable artifacts must be safe to distribute and retain.",
    ),
)
