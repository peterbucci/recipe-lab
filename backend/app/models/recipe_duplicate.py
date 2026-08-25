from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.recipe import RecipeVersion
    from app.models.user import User


RECIPE_DUPLICATE_EXACT = "exact_duplicate"
RECIPE_DUPLICATE_PROBABLE = "probable_duplicate"
RECIPE_DUPLICATE_DISTINCT = "distinct"
RECIPE_DUPLICATE_CLASSIFICATIONS = (
    RECIPE_DUPLICATE_EXACT,
    RECIPE_DUPLICATE_PROBABLE,
    RECIPE_DUPLICATE_DISTINCT,
)
RECIPE_DUPLICATE_CANDIDATE_CLASSIFICATIONS = (
    RECIPE_DUPLICATE_EXACT,
    RECIPE_DUPLICATE_PROBABLE,
)

RECIPE_DUPLICATE_DECISION_CONTINUE = "continue"
RECIPE_DUPLICATE_DECISION_REVISE = "revise"
RECIPE_DUPLICATE_DECISIONS = (
    RECIPE_DUPLICATE_DECISION_CONTINUE,
    RECIPE_DUPLICATE_DECISION_REVISE,
)


class RecipeDuplicatePreflight(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Immutable, member-scoped evidence from one duplicate-candidate preflight."""

    __tablename__ = "recipe_duplicate_preflights"
    __table_args__ = (
        CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="request_sha256",
        ),
        CheckConstraint(
            "subject_fingerprint_algorithm ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name="subject_algorithm_format",
        ),
        CheckConstraint(
            "subject_fingerprint_digest ~ '^[0-9a-f]{64}$'",
            name="subject_digest_sha256",
        ),
        CheckConstraint(
            "policy_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name="policy_version_format",
        ),
        CheckConstraint(
            f"classification IN {RECIPE_DUPLICATE_CLASSIFICATIONS!r}",
            name="classification_supported",
        ),
        CheckConstraint(
            "same_parent_no_change = false OR "
            "(classification = 'exact_duplicate' AND source_version_id IS NOT NULL)",
            name="same_parent_consistent",
        ),
        CheckConstraint(
            "result_digest ~ '^[0-9a-f]{64}$'",
            name="result_digest_lowercase_sha256",
        ),
        UniqueConstraint(
            "actor_user_id",
            "action_id",
            name="uq_recipe_duplicate_preflights_actor_action",
        ),
        UniqueConstraint(
            "id",
            "policy_version",
            "subject_fingerprint_algorithm",
            name="uq_recipe_duplicate_preflights_id_policy_algorithm",
        ),
        UniqueConstraint(
            "id",
            "actor_user_id",
            "policy_version",
            "result_digest",
            name="uq_recipe_duplicate_preflights_id_actor_policy_result",
        ),
        Index(
            "ix_recipe_duplicate_preflights_actor_created_id",
            "actor_user_id",
            "created_at",
            "id",
        ),
        Index("ix_recipe_duplicate_preflights_source_version_id", "source_version_id"),
    )

    actor_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    action_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    source_version_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        nullable=True,
    )
    subject_fingerprint_algorithm: Mapped[str] = mapped_column(String(64), nullable=False)
    subject_fingerprint_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    classification: Mapped[str] = mapped_column(String(24), nullable=False)
    same_parent_no_change: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    result_digest: Mapped[str] = mapped_column(String(64), nullable=False)

    actor: Mapped["User"] = relationship(foreign_keys=[actor_user_id])
    source_version: Mapped["RecipeVersion | None"] = relationship(foreign_keys=[source_version_id])
    candidates: Mapped[list["RecipeDuplicateCandidate"]] = relationship(
        back_populates="preflight",
        order_by="RecipeDuplicateCandidate.rank",
        passive_deletes="all",
    )
    decision: Mapped["RecipeDuplicateDecision | None"] = relationship(
        back_populates="preflight",
        uselist=False,
        passive_deletes="all",
    )


class RecipeDuplicateCandidate(Base):
    """One bounded public candidate attached to immutable preflight evidence."""

    __tablename__ = "recipe_duplicate_candidates"
    __table_args__ = (
        ForeignKeyConstraint(
            ["preflight_id", "policy_version", "fingerprint_algorithm_version"],
            [
                "recipe_duplicate_preflights.id",
                "recipe_duplicate_preflights.policy_version",
                "recipe_duplicate_preflights.subject_fingerprint_algorithm",
            ],
            name="fk_recipe_duplicate_candidates_preflight_policy_algorithm",
            ondelete="RESTRICT",
        ),
        CheckConstraint("rank BETWEEN 1 AND 5", name="rank_bounded"),
        CheckConstraint(
            f"classification IN {RECIPE_DUPLICATE_CANDIDATE_CLASSIFICATIONS!r}",
            name="classification_supported",
        ),
        CheckConstraint(
            "score_basis_points BETWEEN 0 AND 10000",
            name="score_basis_points_bounded",
        ),
        CheckConstraint(
            "jsonb_typeof(reason_codes) = 'array' "
            "AND jsonb_array_length(reason_codes) BETWEEN 1 AND 3",
            name="reason_codes_bounded_array",
        ),
        CheckConstraint(
            "(classification = 'exact_duplicate' "
            "AND reason_codes = '[\"exact_structural_match\"]'::jsonb) "
            "OR (classification = 'probable_duplicate' "
            "AND jsonb_array_length(reason_codes) = 3 "
            "AND (reason_codes ->> 0) IN "
            "('same_ingredient_multiset', 'overlapping_ingredient_multisets', "
            "'different_ingredient_multisets') "
            "AND (reason_codes ->> 1) IN "
            "('proportionally_scaled_quantities', 'matching_quantities', "
            "'partially_matching_quantities', 'different_quantities') "
            "AND (reason_codes ->> 2) IN "
            "('matching_structured_actions', 'different_action_order', "
            "'different_ordered_inputs', 'different_duration_or_temperature'))",
            name="reason_codes_supported_ordered",
        ),
        CheckConstraint(
            "fingerprint_algorithm_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name="fingerprint_version_format",
        ),
        CheckConstraint(
            "policy_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name="policy_version_format",
        ),
        CheckConstraint(
            "(classification = 'exact_duplicate' "
            "AND score_basis_points = 10000 AND exact_payload_confirmed = true) "
            "OR (classification = 'probable_duplicate' "
            "AND score_basis_points >= 8000 AND exact_payload_confirmed = false)",
            name="exact_evidence_consistent",
        ),
        UniqueConstraint(
            "preflight_id",
            "rank",
            name="uq_recipe_duplicate_candidates_preflight_rank",
        ),
        Index(
            "ix_recipe_duplicate_candidates_public_version",
            "public_recipe_version_id",
        ),
    )

    preflight_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
    )
    public_recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    classification: Mapped[str] = mapped_column(String(24), nullable=False)
    score_basis_points: Mapped[int] = mapped_column(Integer, nullable=False)
    reason_codes: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    fingerprint_algorithm_version: Mapped[str] = mapped_column(String(64), nullable=False)
    policy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    exact_payload_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False)

    preflight: Mapped[RecipeDuplicatePreflight] = relationship(back_populates="candidates")
    public_recipe_version: Mapped["RecipeVersion"] = relationship()


class RecipeDuplicateDecision(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One immutable author decision acknowledging a specific preflight result."""

    __tablename__ = "recipe_duplicate_decisions"
    __table_args__ = (
        ForeignKeyConstraint(
            [
                "preflight_id",
                "actor_user_id",
                "acknowledged_policy_version",
                "acknowledged_result_digest",
            ],
            [
                "recipe_duplicate_preflights.id",
                "recipe_duplicate_preflights.actor_user_id",
                "recipe_duplicate_preflights.policy_version",
                "recipe_duplicate_preflights.result_digest",
            ],
            name="fk_recipe_duplicate_decisions_preflight_actor_acknowledgement",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            f"decision IN {RECIPE_DUPLICATE_DECISIONS!r}",
            name="decision_supported",
        ),
        CheckConstraint(
            "acknowledged_policy_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name="ack_policy_format",
        ),
        CheckConstraint(
            "acknowledged_result_digest ~ '^[0-9a-f]{64}$'",
            name="ack_result_sha256",
        ),
        UniqueConstraint(
            "preflight_id",
            name="uq_recipe_duplicate_decisions_preflight_id",
        ),
        UniqueConstraint(
            "actor_user_id",
            "action_id",
            name="uq_recipe_duplicate_decisions_actor_action",
        ),
        Index(
            "ix_recipe_duplicate_decisions_actor_created_id",
            "actor_user_id",
            "created_at",
            "id",
        ),
    )

    preflight_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
    )
    actor_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    action_id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    acknowledged_policy_version: Mapped[str] = mapped_column(String(64), nullable=False)
    acknowledged_result_digest: Mapped[str] = mapped_column(String(64), nullable=False)

    preflight: Mapped[RecipeDuplicatePreflight] = relationship(back_populates="decision")
    actor: Mapped["User"] = relationship(foreign_keys=[actor_user_id], viewonly=True)
