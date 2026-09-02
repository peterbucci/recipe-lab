from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    FetchedValue,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.action import RecipeInstructionAction
    from app.models.engagement import RecipeRating, RecipeSave
    from app.models.ingredient import Ingredient
    from app.models.measurement import IngredientPackageSize, MeasurementUnit
    from app.models.recipe_category import RecipeVersionCategory
    from app.models.recipe_draft import RecipeDraft
    from app.models.recipe_fingerprint import RecipeStructuralFingerprint
    from app.models.user import User


RECIPE_PUBLICATION_STATE_PUBLISHED = "published"
RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN = "author_withdrawn"
RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN = "moderation_hidden"
RECIPE_PUBLICATION_STATES = (
    RECIPE_PUBLICATION_STATE_PUBLISHED,
    RECIPE_PUBLICATION_STATE_AUTHOR_WITHDRAWN,
    RECIPE_PUBLICATION_STATE_MODERATION_HIDDEN,
)

RECIPE_DIFFICULTY_EASY = "easy"
RECIPE_DIFFICULTY_MEDIUM = "medium"
RECIPE_DIFFICULTY_HARD = "hard"
RECIPE_DIFFICULTIES = (
    RECIPE_DIFFICULTY_EASY,
    RECIPE_DIFFICULTY_MEDIUM,
    RECIPE_DIFFICULTY_HARD,
)


class RecipeLineage(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "recipe_lineages"

    created_by_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    versions: Mapped[list["RecipeVersion"]] = relationship(
        back_populates="lineage",
        order_by="RecipeVersion.version_number",
        passive_deletes="all",
    )


class RecipeVersion(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "recipe_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["lineage_id", "parent_version_id"],
            ["recipe_versions.lineage_id", "recipe_versions.id"],
            name="fk_recipe_versions_parent_same_lineage",
            ondelete="RESTRICT",
        ),
        CheckConstraint("version_number >= 1", name="version_number_positive"),
        CheckConstraint("btrim(title) <> ''", name="title_not_blank"),
        CheckConstraint("servings > 0", name="servings_positive"),
        CheckConstraint(
            "total_time_minutes IS NULL OR total_time_minutes > 0",
            name="total_time_minutes_positive",
        ),
        CheckConstraint(
            "active_time_minutes IS NULL OR active_time_minutes > 0",
            name="active_time_minutes_positive",
        ),
        CheckConstraint(
            "total_time_minutes IS NULL OR active_time_minutes IS NULL "
            "OR active_time_minutes <= total_time_minutes",
            name="active_time_not_greater_than_total",
        ),
        CheckConstraint(
            f"difficulty IS NULL OR difficulty IN {RECIPE_DIFFICULTIES!r}",
            name="difficulty_supported",
        ),
        CheckConstraint(
            "notes IS NULL OR (NULLIF(btrim(notes), '') IS NOT NULL "
            "AND char_length(notes) <= 5000)",
            name="notes_valid",
        ),
        CheckConstraint(
            "parent_version_id IS NULL OR parent_version_id <> id",
            name="parent_not_self",
        ),
        UniqueConstraint("lineage_id", "id", name="uq_recipe_versions_lineage_id_id"),
        UniqueConstraint("id", "created_by_user_id", name="uq_recipe_versions_id_author"),
        UniqueConstraint(
            "lineage_id",
            "version_number",
            name="uq_recipe_versions_lineage_id_version_number",
        ),
        Index(
            "uq_recipe_versions_one_root_per_lineage",
            "lineage_id",
            unique=True,
            postgresql_where=text("parent_version_id IS NULL"),
        ),
        Index("ix_recipe_versions_parent_version_id", "parent_version_id"),
    )

    lineage_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_lineages.id", ondelete="RESTRICT"),
        nullable=False,
    )
    parent_version_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    created_by_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    servings: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    total_time_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_time_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    difficulty: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    lineage: Mapped[RecipeLineage] = relationship(back_populates="versions")
    author: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])
    parent: Mapped["RecipeVersion | None"] = relationship(
        back_populates="descendants",
        primaryjoin="RecipeVersion.parent_version_id == RecipeVersion.id",
        foreign_keys="RecipeVersion.parent_version_id",
        remote_side="RecipeVersion.id",
    )
    descendants: Mapped[list["RecipeVersion"]] = relationship(
        back_populates="parent",
        primaryjoin="RecipeVersion.id == RecipeVersion.parent_version_id",
        foreign_keys="RecipeVersion.parent_version_id",
        order_by="RecipeVersion.version_number",
        passive_deletes="all",
    )
    ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="recipe_version",
        order_by="RecipeIngredient.display_order",
        passive_deletes="all",
    )
    instructions: Mapped[list["RecipeInstruction"]] = relationship(
        back_populates="recipe_version",
        order_by="RecipeInstruction.display_order",
        passive_deletes="all",
    )
    saves: Mapped[list["RecipeSave"]] = relationship(
        back_populates="recipe_version",
        passive_deletes="all",
    )
    ratings: Mapped[list["RecipeRating"]] = relationship(
        back_populates="recipe_version",
        passive_deletes="all",
    )
    structural_fingerprints: Mapped[list["RecipeStructuralFingerprint"]] = relationship(
        back_populates="recipe_version",
        order_by="RecipeStructuralFingerprint.algorithm_version",
        passive_deletes="all",
    )
    publication: Mapped["RecipeVersionPublication | None"] = relationship(
        back_populates="recipe_version",
        uselist=False,
        viewonly=True,
    )
    categories: Mapped[list["RecipeVersionCategory"]] = relationship(
        back_populates="recipe_version",
        order_by="RecipeVersionCategory.display_order",
        passive_deletes="all",
    )


class RecipeVersionPublication(Base):
    """Visibility and successful-publication evidence for one immutable version."""

    __tablename__ = "recipe_version_publications"
    __table_args__ = (
        ForeignKeyConstraint(
            ["recipe_version_id", "actor_user_id"],
            ["recipe_versions.id", "recipe_versions.created_by_user_id"],
            name="fk_recipe_version_publications_version_author",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["source_draft_id", "actor_user_id", "draft_revision"],
            ["recipe_drafts.id", "recipe_drafts.author_user_id", "recipe_drafts.revision"],
            name="fk_recipe_version_publications_draft_author_revision",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            [
                "duplicate_preflight_id",
                "actor_user_id",
                "duplicate_policy_version",
                "duplicate_result_digest",
            ],
            [
                "recipe_duplicate_preflights.id",
                "recipe_duplicate_preflights.actor_user_id",
                "recipe_duplicate_preflights.policy_version",
                "recipe_duplicate_preflights.result_digest",
            ],
            name="fk_recipe_version_publications_preflight_acknowledgement",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            [
                "duplicate_decision_id",
                "duplicate_preflight_id",
                "actor_user_id",
                "duplicate_policy_version",
                "duplicate_result_digest",
            ],
            [
                "recipe_duplicate_decisions.id",
                "recipe_duplicate_decisions.preflight_id",
                "recipe_duplicate_decisions.actor_user_id",
                "recipe_duplicate_decisions.acknowledged_policy_version",
                "recipe_duplicate_decisions.acknowledged_result_digest",
            ],
            name="fk_recipe_version_publications_decision_acknowledgement",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "state IN ('published', 'author_withdrawn', 'moderation_hidden')",
            name="state_supported",
        ),
        CheckConstraint(
            "(state = 'published' "
            "AND author_withdrawn_at IS NULL AND moderation_hidden_at IS NULL) OR "
            "(state = 'author_withdrawn' "
            "AND author_withdrawn_at IS NOT NULL AND moderation_hidden_at IS NULL) OR "
            "(state = 'moderation_hidden' AND moderation_hidden_at IS NOT NULL)",
            name="visibility_shape_valid",
        ),
        CheckConstraint(
            "request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'",
            name="request_fingerprint_sha256",
        ),
        CheckConstraint(
            "draft_revision IS NULL OR draft_revision >= 1",
            name="draft_revision_positive",
        ),
        CheckConstraint(
            "(community_rules_version IS NULL "
            "AND publication_rights_confirmed_at IS NULL) OR "
            "(NULLIF(btrim(community_rules_version), '') IS NOT NULL "
            "AND publication_rights_confirmed_at IS NOT NULL)",
            name="publication_attestations",
        ),
        CheckConstraint(
            "(source_draft_id IS NULL AND action_id IS NULL "
            "AND request_fingerprint IS NULL AND draft_revision IS NULL "
            "AND duplicate_preflight_id IS NULL AND duplicate_policy_version IS NULL "
            "AND duplicate_result_digest IS NULL AND duplicate_decision_id IS NULL) OR "
            "(source_draft_id IS NOT NULL AND action_id IS NOT NULL "
            "AND request_fingerprint IS NOT NULL AND draft_revision IS NOT NULL "
            "AND duplicate_preflight_id IS NOT NULL "
            "AND NULLIF(btrim(duplicate_policy_version), '') IS NOT NULL "
            "AND duplicate_result_digest ~ '^[0-9a-f]{64}$')",
            name="evidence_shape_valid",
        ),
        UniqueConstraint("source_draft_id", name="uq_recipe_version_publications_source_draft"),
        UniqueConstraint(
            "actor_user_id",
            "action_id",
            name="uq_recipe_version_publications_actor_action",
        ),
        Index("ix_recipe_version_publications_state_version", "state", "recipe_version_id"),
        Index(
            "ix_recipe_version_publications_actor_published",
            "actor_user_id",
            "published_at",
            "recipe_version_id",
        ),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
    )
    state: Mapped[str] = mapped_column(
        String(24),
        nullable=False,
        default=RECIPE_PUBLICATION_STATE_PUBLISHED,
        server_default=text(f"'{RECIPE_PUBLICATION_STATE_PUBLISHED}'"),
    )
    author_withdrawn_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    moderation_hidden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    state_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )
    state_changed_by_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        server_default=FetchedValue(),
        index=True,
    )
    source_draft_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
    )
    actor_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    action_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    request_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    draft_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duplicate_preflight_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
    )
    duplicate_policy_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duplicate_result_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    duplicate_decision_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
    )
    community_rules_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    publication_rights_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )

    recipe_version: Mapped[RecipeVersion] = relationship(
        back_populates="publication",
        viewonly=True,
    )
    source_draft: Mapped["RecipeDraft | None"] = relationship(
        back_populates="publication",
        viewonly=True,
    )


class RecipeVersionVisibilityEvent(Base):
    """Append-only audit evidence for one publication visibility transition."""

    __tablename__ = "recipe_version_visibility_events"
    __table_args__ = (
        CheckConstraint(
            "previous_state IS NULL OR "
            "previous_state IN ('published', 'author_withdrawn', 'moderation_hidden')",
            name="previous_state_supported",
        ),
        CheckConstraint(
            "state IN ('published', 'author_withdrawn', 'moderation_hidden')",
            name="state_supported",
        ),
        CheckConstraint(
            "(state = 'published' "
            "AND author_withdrawn_at IS NULL AND moderation_hidden_at IS NULL) OR "
            "(state = 'author_withdrawn' "
            "AND author_withdrawn_at IS NOT NULL AND moderation_hidden_at IS NULL) OR "
            "(state = 'moderation_hidden' AND moderation_hidden_at IS NOT NULL)",
            name="visibility_shape_valid",
        ),
        Index(
            "ix_recipe_version_visibility_events_version_occurred_id",
            "recipe_version_id",
            "occurred_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_version_publications.recipe_version_id", ondelete="RESTRICT"),
        nullable=False,
    )
    actor_user_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    previous_state: Mapped[str | None] = mapped_column(String(24), nullable=True)
    state: Mapped[str] = mapped_column(String(24), nullable=False)
    author_withdrawn_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    moderation_hidden_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
    )


class RecipeIngredient(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "recipe_version_ingredients"
    __table_args__ = (
        ForeignKeyConstraint(
            ["package_size_id", "ingredient_id", "measurement_unit_id"],
            [
                "ingredient_package_sizes.id",
                "ingredient_package_sizes.ingredient_id",
                "ingredient_package_sizes.package_unit_id",
            ],
            name="fk_recipe_version_ingredients_package_size_ingredient_unit",
            ondelete="RESTRICT",
        ),
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        CheckConstraint(
            "(measure_mode = 'exact' "
            "AND quantity_min IS NOT NULL AND quantity_min > 0 "
            "AND quantity_max IS NULL "
            "AND measurement_unit_id IS NOT NULL "
            "AND NULLIF(btrim(unit_display), '') IS NOT NULL) "
            "OR (measure_mode = 'range' "
            "AND quantity_min IS NOT NULL AND quantity_min > 0 "
            "AND quantity_max IS NOT NULL AND quantity_max > quantity_min "
            "AND measurement_unit_id IS NOT NULL "
            "AND NULLIF(btrim(unit_display), '') IS NOT NULL) "
            "OR (measure_mode IN ('to_taste', 'as_needed', 'unspecified') "
            "AND quantity_min IS NULL AND quantity_max IS NULL "
            "AND measurement_unit_id IS NULL AND unit_display IS NULL "
            "AND package_size_id IS NULL)",
            name="measure_shape_valid",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint(
            "recipe_version_id",
            "display_order",
            name="uq_recipe_version_ingredients_version_display_order",
        ),
        UniqueConstraint(
            "recipe_version_id",
            "id",
            name="uq_recipe_version_ingredients_version_id",
        ),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    measure_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity_min: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    quantity_max: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    measurement_unit_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    unit_display: Mapped[str | None] = mapped_column(String(64), nullable=True)
    package_size_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
        index=True,
    )
    preparation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    recipe_version: Mapped[RecipeVersion] = relationship(back_populates="ingredients")
    ingredient: Mapped["Ingredient"] = relationship(back_populates="recipe_ingredients")
    measurement_unit: Mapped["MeasurementUnit | None"] = relationship()
    package_size: Mapped["IngredientPackageSize | None"] = relationship(viewonly=True)


class RecipeInstruction(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "recipe_version_instructions"
    __table_args__ = (
        CheckConstraint("btrim(instruction) <> ''", name="instruction_not_blank"),
        CheckConstraint(
            "title IS NULL OR (NULLIF(btrim(title), '') IS NOT NULL AND char_length(title) <= 200)",
            name="title_valid",
        ),
        CheckConstraint("display_order >= 0", name="display_order_nonnegative"),
        UniqueConstraint(
            "recipe_version_id",
            "display_order",
            name="uq_recipe_version_instructions_version_display_order",
        ),
        UniqueConstraint(
            "recipe_version_id",
            "id",
            name="uq_recipe_version_instructions_version_id",
        ),
    )

    recipe_version_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("recipe_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    instruction: Mapped[str] = mapped_column(Text, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False)

    recipe_version: Mapped[RecipeVersion] = relationship(back_populates="instructions")
    actions: Mapped[list["RecipeInstructionAction"]] = relationship(
        back_populates="instruction",
        order_by="RecipeInstructionAction.display_order",
        passive_deletes="all",
    )
