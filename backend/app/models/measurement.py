from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.ingredient import Ingredient


MEASUREMENT_DIMENSION_MASS = "mass"
MEASUREMENT_DIMENSION_VOLUME = "volume"
MEASUREMENT_DIMENSION_COUNT = "count"
MEASUREMENT_DIMENSION_TIME = "time"
MEASUREMENT_DIMENSION_TEMPERATURE = "temperature"
MEASUREMENT_DIMENSION_PACKAGE = "package"
MEASUREMENT_DIMENSIONS = (
    MEASUREMENT_DIMENSION_MASS,
    MEASUREMENT_DIMENSION_VOLUME,
    MEASUREMENT_DIMENSION_COUNT,
    MEASUREMENT_DIMENSION_TIME,
    MEASUREMENT_DIMENSION_TEMPERATURE,
    MEASUREMENT_DIMENSION_PACKAGE,
)

MEASUREMENT_DISPLAY_STYLE_SYMBOL = "symbol"
MEASUREMENT_DISPLAY_STYLE_WORD = "word"
MEASUREMENT_DISPLAY_STYLE_HIDDEN = "hidden"
MEASUREMENT_DISPLAY_STYLES = (
    MEASUREMENT_DISPLAY_STYLE_SYMBOL,
    MEASUREMENT_DISPLAY_STYLE_WORD,
    MEASUREMENT_DISPLAY_STYLE_HIDDEN,
)


class MeasurementUnit(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One curated, stable measurement identity.

    Keys and labels are treated as immutable catalog data. A superseded unit is
    made inactive so historical recipe snapshots can still be rendered.
    """

    __tablename__ = "measurement_units"

    key: Mapped[str] = mapped_column(String(64), nullable=False)
    dimension: Mapped[str] = mapped_column(String(16), nullable=False)
    conversion_family: Mapped[str] = mapped_column(String(64), nullable=False)
    canonical_label: Mapped[str] = mapped_column(String(64), nullable=False)
    plural_label: Mapped[str] = mapped_column(String(64), nullable=False)
    symbol: Mapped[str | None] = mapped_column(String(16), nullable=True)
    display_style: Mapped[str] = mapped_column(String(16), nullable=False)
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    provenance: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'",
            name="key_supported_format",
        ),
        CheckConstraint(
            "dimension IN ('mass', 'volume', 'count', 'time', 'temperature', 'package')",
            name="dimension_supported",
        ),
        CheckConstraint(
            "btrim(conversion_family) <> ''",
            name="conversion_family_not_blank",
        ),
        CheckConstraint("btrim(canonical_label) <> ''", name="canonical_label_not_blank"),
        CheckConstraint("btrim(plural_label) <> ''", name="plural_label_not_blank"),
        CheckConstraint("symbol IS NULL OR btrim(symbol) <> ''", name="symbol_not_blank"),
        CheckConstraint(
            "display_style IN ('symbol', 'word', 'hidden')",
            name="display_style_supported",
        ),
        CheckConstraint(
            "display_style <> 'symbol' OR symbol IS NOT NULL",
            name="symbol_style_requires_symbol",
        ),
        CheckConstraint("btrim(provenance) <> ''", name="provenance_not_blank"),
        Index(
            "uq_measurement_units_key_normalized",
            func.lower(func.btrim(key)),
            unique=True,
        ),
        Index(
            "uq_measurement_units_canonical_label_normalized",
            func.lower(func.btrim(canonical_label)),
            unique=True,
        ),
        Index(
            "ix_measurement_units_active_dimension",
            "active",
            "dimension",
        ),
    )

    aliases: Mapped[list["MeasurementUnitAlias"]] = relationship(
        back_populates="measurement_unit",
        order_by="MeasurementUnitAlias.alias",
        passive_deletes="all",
    )
    conversion_rule: Mapped["MeasurementConversionRule | None"] = relationship(
        back_populates="unit",
        foreign_keys="MeasurementConversionRule.unit_id",
        uselist=False,
        passive_deletes="all",
    )


class MeasurementUnitAlias(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "measurement_unit_aliases"

    measurement_unit_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    alias: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (
        CheckConstraint("btrim(alias) <> ''", name="alias_not_blank"),
        Index(
            "uq_measurement_unit_aliases_alias_normalized",
            func.lower(func.btrim(alias)),
            unique=True,
        ),
    )

    measurement_unit: Mapped[MeasurementUnit] = relationship(back_populates="aliases")


class MeasurementConversionRule(CreatedAtMixin, Base):
    """A reviewed affine rule to one unit family's explicit base unit.

    ``base = (value + offset_numerator / offset_denominator)
    * scale_numerator / scale_denominator``
    """

    __tablename__ = "measurement_conversion_rules"

    unit_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    base_unit_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    scale_numerator: Mapped[int] = mapped_column(BigInteger, nullable=False)
    scale_denominator: Mapped[int] = mapped_column(BigInteger, nullable=False)
    offset_numerator: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    offset_denominator: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    provenance: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint("scale_numerator > 0", name="scale_numerator_positive"),
        CheckConstraint("scale_denominator > 0", name="scale_denominator_positive"),
        CheckConstraint("offset_denominator > 0", name="offset_denominator_positive"),
        CheckConstraint("btrim(provenance) <> ''", name="provenance_not_blank"),
    )

    unit: Mapped[MeasurementUnit] = relationship(
        back_populates="conversion_rule",
        foreign_keys=[unit_id],
    )
    base_unit: Mapped[MeasurementUnit] = relationship(foreign_keys=[base_unit_id])


class IngredientDensityRule(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One reviewed, ingredient-specific mass-to-volume relationship."""

    __tablename__ = "ingredient_density_rules"

    ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    mass_unit_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=False,
    )
    volume_unit_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=False,
    )
    mass_value: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    volume_value: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    provenance: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint("mass_value > 0", name="mass_value_positive"),
        CheckConstraint("volume_value > 0", name="volume_value_positive"),
        CheckConstraint("mass_unit_id <> volume_unit_id", name="units_must_differ"),
        CheckConstraint("btrim(provenance) <> ''", name="provenance_not_blank"),
        UniqueConstraint(
            "ingredient_id",
            "mass_unit_id",
            "volume_unit_id",
            name="uq_ingredient_density_rules_ingredient_mass_volume",
        ),
    )

    ingredient: Mapped["Ingredient"] = relationship()
    mass_unit: Mapped[MeasurementUnit] = relationship(foreign_keys=[mass_unit_id])
    volume_unit: Mapped[MeasurementUnit] = relationship(foreign_keys=[volume_unit_id])


class IngredientPackageSize(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """An explicit package label and its reviewed ingredient-specific contents."""

    __tablename__ = "ingredient_package_sizes"

    ingredient_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ingredients.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    package_unit_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=False,
    )
    content_unit_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("measurement_units.id", ondelete="RESTRICT"),
        nullable=False,
    )
    content_value: Mapped[Decimal] = mapped_column(Numeric(18, 6), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("true"),
    )
    provenance: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint("content_value > 0", name="content_value_positive"),
        CheckConstraint("package_unit_id <> content_unit_id", name="units_must_differ"),
        CheckConstraint("btrim(label) <> ''", name="label_not_blank"),
        CheckConstraint("btrim(provenance) <> ''", name="provenance_not_blank"),
        UniqueConstraint(
            "id",
            "ingredient_id",
            "package_unit_id",
            name="uq_ingredient_package_sizes_id_ingredient_unit",
        ),
        Index(
            "uq_ingredient_package_sizes_ingredient_unit_label_normalized",
            "ingredient_id",
            "package_unit_id",
            func.lower(func.btrim(label)),
            unique=True,
        ),
    )

    ingredient: Mapped["Ingredient"] = relationship()
    package_unit: Mapped[MeasurementUnit] = relationship(foreign_keys=[package_unit_id])
    content_unit: Mapped[MeasurementUnit] = relationship(foreign_keys=[content_unit_id])
