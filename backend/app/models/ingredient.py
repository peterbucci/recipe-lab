from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    event,
    func,
)
from sqlalchemy import (
    inspect as sqlalchemy_inspect,
)
from sqlalchemy.orm import Mapped, Session, mapped_column, relationship

from app.catalog_names import catalog_name_digest, catalog_name_id, normalize_catalog_name
from app.db.base import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.recipe import RecipeIngredient


INGREDIENT_CATALOG_NAME_CANONICAL = "canonical"
INGREDIENT_CATALOG_NAME_ALIAS = "alias"
INGREDIENT_CATALOG_NAME_KINDS = (
    INGREDIENT_CATALOG_NAME_CANONICAL,
    INGREDIENT_CATALOG_NAME_ALIAS,
)
_INGREDIENT_CATALOG_NAMES_TABLE = "ingredient_catalog_names"
_INGREDIENT_CATALOG_NAMES_SESSION_KEY = "ingredient_catalog_names_table_present"


ingredient_dietary_flags = Table(
    "ingredient_dietary_flags",
    Base.metadata,
    Column(
        "ingredient_id",
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "dietary_flag_id",
        Uuid(as_uuid=True),
        ForeignKey("dietary_flags.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
    Index("ix_ingredient_dietary_flags_dietary_flag_id", "dietary_flag_id"),
)


ingredient_allergens = Table(
    "ingredient_allergens",
    Base.metadata,
    Column(
        "ingredient_id",
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "allergen_id",
        Uuid(as_uuid=True),
        ForeignKey("allergens.id", ondelete="RESTRICT"),
        primary_key=True,
    ),
    Index("ix_ingredient_allergens_allergen_id", "allergen_id"),
)


class IngredientCatalogName(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One normalized key in the shared canonical-and-alias namespace."""

    __tablename__ = _INGREDIENT_CATALOG_NAMES_TABLE

    name_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_name_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    canonical_ingredient_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="CASCADE"),
        nullable=True,
    )
    ingredient_alias_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredient_aliases.id", ondelete="CASCADE"),
        nullable=True,
    )

    __table_args__ = (
        CheckConstraint(
            f"name_kind IN {INGREDIENT_CATALOG_NAME_KINDS!r}",
            name="name_kind_supported",
        ),
        CheckConstraint("btrim(display_name) <> ''", name="display_name_not_blank"),
        CheckConstraint("btrim(normalized_name) <> ''", name="normalized_name_not_blank"),
        CheckConstraint(
            "normalized_name_digest ~ '^[0-9a-f]{64}$'",
            name="normalized_name_digest_sha256",
        ),
        CheckConstraint(
            "normalized_name_digest = encode(sha256(convert_to(normalized_name, 'UTF8')), 'hex')",
            name="normalized_name_digest_matches",
        ),
        CheckConstraint(
            "(name_kind = 'canonical' AND canonical_ingredient_id IS NOT NULL "
            "AND ingredient_alias_id IS NULL) OR "
            "(name_kind = 'alias' AND canonical_ingredient_id IS NULL "
            "AND ingredient_alias_id IS NOT NULL)",
            name="source_shape_valid",
        ),
        UniqueConstraint(
            "canonical_ingredient_id",
            name="uq_ingredient_catalog_names_canonical_ingredient",
        ),
        UniqueConstraint(
            "ingredient_alias_id",
            name="uq_ingredient_catalog_names_ingredient_alias",
        ),
        Index(
            "uq_ingredient_catalog_names_normalized_digest",
            "normalized_name_digest",
            unique=True,
        ),
    )

    canonical_ingredient: Mapped["Ingredient | None"] = relationship(
        back_populates="catalog_name",
    )
    ingredient_alias: Mapped["IngredientAlias | None"] = relationship(
        back_populates="catalog_name",
    )


class IngredientCategory(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "ingredient_categories"

    name: Mapped[str] = mapped_column(String(100), nullable=False)

    __table_args__ = (
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        Index(
            "uq_ingredient_categories_name_normalized",
            func.lower(func.btrim(name)),
            unique=True,
        ),
    )


class DietaryFlag(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "dietary_flags"

    name: Mapped[str] = mapped_column(String(100), nullable=False)

    __table_args__ = (
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        Index(
            "uq_dietary_flags_name_normalized",
            func.lower(func.btrim(name)),
            unique=True,
        ),
    )


class Allergen(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "allergens"

    name: Mapped[str] = mapped_column(String(100), nullable=False)

    __table_args__ = (
        CheckConstraint("btrim(name) <> ''", name="name_not_blank"),
        Index(
            "uq_allergens_name_normalized",
            func.lower(func.btrim(name)),
            unique=True,
        ),
    )


class Ingredient(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "ingredients"

    canonical_name: Mapped[str] = mapped_column(String(200), nullable=False)
    category_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredient_categories.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )

    __table_args__ = (
        CheckConstraint("btrim(canonical_name) <> ''", name="canonical_name_not_blank"),
        Index(
            "uq_ingredients_canonical_name_normalized",
            func.lower(func.btrim(canonical_name)),
            unique=True,
        ),
    )

    category: Mapped[IngredientCategory | None] = relationship()
    catalog_name: Mapped[IngredientCatalogName | None] = relationship(
        back_populates="canonical_ingredient",
        cascade="all, delete-orphan",
        passive_deletes=True,
        single_parent=True,
        uselist=False,
    )
    aliases: Mapped[list["IngredientAlias"]] = relationship(
        back_populates="ingredient",
        order_by="IngredientAlias.alias",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    dietary_flags: Mapped[list[DietaryFlag]] = relationship(
        secondary=ingredient_dietary_flags,
        passive_deletes=True,
    )
    allergens: Mapped[list[Allergen]] = relationship(
        secondary=ingredient_allergens,
        passive_deletes=True,
    )
    recipe_ingredients: Mapped[list["RecipeIngredient"]] = relationship(
        back_populates="ingredient",
        passive_deletes="all",
    )
    outgoing_substitutions: Mapped[list["IngredientSubstitution"]] = relationship(
        back_populates="source_ingredient",
        foreign_keys="IngredientSubstitution.source_ingredient_id",
        passive_deletes="all",
    )
    incoming_substitutions: Mapped[list["IngredientSubstitution"]] = relationship(
        back_populates="replacement_ingredient",
        foreign_keys="IngredientSubstitution.replacement_ingredient_id",
        passive_deletes="all",
    )


class IngredientAlias(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "ingredient_aliases"

    ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    alias: Mapped[str] = mapped_column(String(200), nullable=False)

    __table_args__ = (
        CheckConstraint("btrim(alias) <> ''", name="alias_not_blank"),
        Index(
            "uq_ingredient_aliases_alias_normalized",
            func.lower(func.btrim(alias)),
            unique=True,
        ),
    )

    ingredient: Mapped[Ingredient] = relationship(back_populates="aliases")
    catalog_name: Mapped[IngredientCatalogName | None] = relationship(
        back_populates="ingredient_alias",
        cascade="all, delete-orphan",
        passive_deletes=True,
        single_parent=True,
        uselist=False,
    )


class IngredientSubstitution(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "ingredient_substitutions"

    source_ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            "ingredients.id",
            name="fk_ingredient_substitutions_source_ingredient",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    replacement_ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey(
            "ingredients.id",
            name="fk_ingredient_substitutions_replacement_ingredient",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    quantity_ratio: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    guidance: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    provenance: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)

    __table_args__ = (
        CheckConstraint(
            "source_ingredient_id <> replacement_ingredient_id",
            name="ingredients_must_differ",
        ),
        CheckConstraint(
            "quantity_ratio IS NULL OR quantity_ratio > 0",
            name="quantity_ratio_positive",
        ),
        CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1",
            name="confidence_supported_range",
        ),
        CheckConstraint(
            "quantity_ratio IS NOT NULL OR NULLIF(btrim(guidance), '') IS NOT NULL",
            name="ratio_or_guidance_required",
        ),
        CheckConstraint(
            "NULLIF(btrim(provenance), '') IS NOT NULL OR confidence IS NOT NULL",
            name="provenance_or_confidence_required",
        ),
        CheckConstraint(
            "guidance IS NULL OR btrim(guidance) <> ''",
            name="guidance_not_blank",
        ),
        CheckConstraint("notes IS NULL OR btrim(notes) <> ''", name="notes_not_blank"),
        CheckConstraint(
            "provenance IS NULL OR btrim(provenance) <> ''",
            name="provenance_not_blank",
        ),
        UniqueConstraint(
            "source_ingredient_id",
            "replacement_ingredient_id",
            name="uq_ingredient_substitutions_source_replacement",
        ),
        Index(
            "ix_ingredient_substitutions_replacement_ingredient_id",
            "replacement_ingredient_id",
        ),
    )

    source_ingredient: Mapped[Ingredient] = relationship(
        back_populates="outgoing_substitutions",
        foreign_keys=[source_ingredient_id],
    )
    replacement_ingredient: Mapped[Ingredient] = relationship(
        back_populates="incoming_substitutions",
        foreign_keys=[replacement_ingredient_id],
    )


def _catalog_name_namespace_is_present(session: Session) -> bool:
    cached = session.info.get(_INGREDIENT_CATALOG_NAMES_SESSION_KEY)
    if isinstance(cached, bool):
        return cached
    present = sqlalchemy_inspect(session.connection()).has_table(_INGREDIENT_CATALOG_NAMES_TABLE)
    session.info[_INGREDIENT_CATALOG_NAMES_SESSION_KEY] = present
    return present


def _synchronize_catalog_name(
    record: IngredientCatalogName,
    *,
    name_kind: str,
    display_name: str,
) -> None:
    normalized_name = normalize_catalog_name(display_name)
    record.name_kind = name_kind
    record.display_name = display_name
    record.normalized_name = normalized_name
    record.normalized_name_digest = catalog_name_digest(normalized_name)


@event.listens_for(Session, "before_flush")
def _stage_ingredient_catalog_names(
    session: Session,
    _flush_context: object,
    _instances: object,
) -> None:
    """Keep ORM writes inside the database-enforced catalog-name namespace."""

    sources = tuple(
        item
        for item in (*session.new, *session.dirty)
        if isinstance(item, (Ingredient, IngredientAlias))
    )
    if not sources or not _catalog_name_namespace_is_present(session):
        return

    for source in sources:
        if isinstance(source, Ingredient):
            history = sqlalchemy_inspect(source).attrs.canonical_name.history
            if source not in session.new and not history.has_changes():
                continue
            record = source.catalog_name
            if record is None:
                record = IngredientCatalogName()
                if source.id is not None:
                    record.id = catalog_name_id(INGREDIENT_CATALOG_NAME_CANONICAL, source.id)
                if source.created_at is not None:
                    record.created_at = source.created_at
                source.catalog_name = record
            _synchronize_catalog_name(
                record,
                name_kind=INGREDIENT_CATALOG_NAME_CANONICAL,
                display_name=source.canonical_name,
            )
            continue

        history = sqlalchemy_inspect(source).attrs.alias.history
        if source not in session.new and not history.has_changes():
            continue
        record = source.catalog_name
        if record is None:
            record = IngredientCatalogName()
            if source.id is not None:
                record.id = catalog_name_id(INGREDIENT_CATALOG_NAME_ALIAS, source.id)
            if source.created_at is not None:
                record.created_at = source.created_at
            source.catalog_name = record
        _synchronize_catalog_name(
            record,
            name_kind=INGREDIENT_CATALOG_NAME_ALIAS,
            display_name=source.alias,
        )
