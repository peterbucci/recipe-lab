"""add structured measurements and migrate legacy recipe quantities

Revision ID: 20260824_0009
Revises: 20260824_0008
Create Date: 2026-08-24 20:00:00.000000

"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op
from sqlalchemy import Connection

from migrations.frozen.catalog_20260824 import (
    load_frozen_measurement_catalog,
    measurement_uuid,
)
from migrations.frozen.measurement_audit_0009 import (
    INGREDIENT_MEASUREMENT_DIMENSIONS,
    bounded_migration_failure,
    build_legacy_measurement_audit,
)

revision: str = "20260824_0009"
down_revision: str | None = "20260824_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_measurement_tables() -> None:
    op.create_table(
        "measurement_units",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("dimension", sa.String(length=16), nullable=False),
        sa.Column("conversion_family", sa.String(length=64), nullable=False),
        sa.Column("canonical_label", sa.String(length=64), nullable=False),
        sa.Column("plural_label", sa.String(length=64), nullable=False),
        sa.Column("symbol", sa.String(length=16), nullable=True),
        sa.Column("display_style", sa.String(length=16), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'",
            name=op.f("ck_measurement_units_key_supported_format"),
        ),
        sa.CheckConstraint(
            "dimension IN ('mass', 'volume', 'count', 'time', 'temperature', 'package')",
            name=op.f("ck_measurement_units_dimension_supported"),
        ),
        sa.CheckConstraint(
            "btrim(conversion_family) <> ''",
            name=op.f("ck_measurement_units_conversion_family_not_blank"),
        ),
        sa.CheckConstraint(
            "btrim(canonical_label) <> ''",
            name=op.f("ck_measurement_units_canonical_label_not_blank"),
        ),
        sa.CheckConstraint(
            "btrim(plural_label) <> ''",
            name=op.f("ck_measurement_units_plural_label_not_blank"),
        ),
        sa.CheckConstraint(
            "symbol IS NULL OR btrim(symbol) <> ''",
            name=op.f("ck_measurement_units_symbol_not_blank"),
        ),
        sa.CheckConstraint(
            "display_style IN ('symbol', 'word', 'hidden')",
            name=op.f("ck_measurement_units_display_style_supported"),
        ),
        sa.CheckConstraint(
            "display_style <> 'symbol' OR symbol IS NOT NULL",
            name=op.f("ck_measurement_units_symbol_style_requires_symbol"),
        ),
        sa.CheckConstraint(
            "btrim(provenance) <> ''",
            name=op.f("ck_measurement_units_provenance_not_blank"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_measurement_units")),
    )
    op.create_index(
        "uq_measurement_units_key_normalized",
        "measurement_units",
        [sa.text("lower(btrim(key))")],
        unique=True,
    )
    op.create_index(
        "uq_measurement_units_canonical_label_normalized",
        "measurement_units",
        [sa.text("lower(btrim(canonical_label))")],
        unique=True,
    )
    op.create_index(
        "ix_measurement_units_active_dimension",
        "measurement_units",
        ["active", "dimension"],
        unique=False,
    )

    op.create_table(
        "measurement_unit_aliases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("measurement_unit_id", sa.Uuid(), nullable=False),
        sa.Column("alias", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "btrim(alias) <> ''",
            name=op.f("ck_measurement_unit_aliases_alias_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["measurement_unit_id"],
            ["measurement_units.id"],
            name=op.f("fk_measurement_unit_aliases_measurement_unit_id_measurement_units"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_measurement_unit_aliases")),
    )
    op.create_index(
        op.f("ix_measurement_unit_aliases_measurement_unit_id"),
        "measurement_unit_aliases",
        ["measurement_unit_id"],
        unique=False,
    )
    op.create_index(
        "uq_measurement_unit_aliases_alias_normalized",
        "measurement_unit_aliases",
        [sa.text("lower(btrim(alias))")],
        unique=True,
    )

    op.create_table(
        "measurement_conversion_rules",
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("base_unit_id", sa.Uuid(), nullable=False),
        sa.Column("scale_numerator", sa.BigInteger(), nullable=False),
        sa.Column("scale_denominator", sa.BigInteger(), nullable=False),
        sa.Column("offset_numerator", sa.BigInteger(), nullable=False),
        sa.Column("offset_denominator", sa.BigInteger(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "scale_numerator > 0",
            name=op.f("ck_measurement_conversion_rules_scale_numerator_positive"),
        ),
        sa.CheckConstraint(
            "scale_denominator > 0",
            name=op.f("ck_measurement_conversion_rules_scale_denominator_positive"),
        ),
        sa.CheckConstraint(
            "offset_denominator > 0",
            name=op.f("ck_measurement_conversion_rules_offset_denominator_positive"),
        ),
        sa.CheckConstraint(
            "btrim(provenance) <> ''",
            name=op.f("ck_measurement_conversion_rules_provenance_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["unit_id"],
            ["measurement_units.id"],
            name=op.f("fk_measurement_conversion_rules_unit_id_measurement_units"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["base_unit_id"],
            ["measurement_units.id"],
            name=op.f("fk_measurement_conversion_rules_base_unit_id_measurement_units"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("unit_id", name=op.f("pk_measurement_conversion_rules")),
    )
    op.create_index(
        op.f("ix_measurement_conversion_rules_base_unit_id"),
        "measurement_conversion_rules",
        ["base_unit_id"],
        unique=False,
    )

    op.create_table(
        "ingredient_density_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ingredient_id", sa.Uuid(), nullable=False),
        sa.Column("mass_unit_id", sa.Uuid(), nullable=False),
        sa.Column("volume_unit_id", sa.Uuid(), nullable=False),
        sa.Column("mass_value", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("volume_value", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "mass_value > 0",
            name=op.f("ck_ingredient_density_rules_mass_value_positive"),
        ),
        sa.CheckConstraint(
            "volume_value > 0",
            name=op.f("ck_ingredient_density_rules_volume_value_positive"),
        ),
        sa.CheckConstraint(
            "mass_unit_id <> volume_unit_id",
            name=op.f("ck_ingredient_density_rules_units_must_differ"),
        ),
        sa.CheckConstraint(
            "btrim(provenance) <> ''",
            name=op.f("ck_ingredient_density_rules_provenance_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["ingredient_id"],
            ["ingredients.id"],
            name=op.f("fk_ingredient_density_rules_ingredient_id_ingredients"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["mass_unit_id"],
            ["measurement_units.id"],
            name=op.f("fk_ingredient_density_rules_mass_unit_id_measurement_units"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["volume_unit_id"],
            ["measurement_units.id"],
            name=op.f("fk_ingredient_density_rules_volume_unit_id_measurement_units"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingredient_density_rules")),
        sa.UniqueConstraint(
            "ingredient_id",
            "mass_unit_id",
            "volume_unit_id",
            name="uq_ingredient_density_rules_ingredient_mass_volume",
        ),
    )
    op.create_index(
        op.f("ix_ingredient_density_rules_ingredient_id"),
        "ingredient_density_rules",
        ["ingredient_id"],
        unique=False,
    )

    op.create_table(
        "ingredient_package_sizes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ingredient_id", sa.Uuid(), nullable=False),
        sa.Column("package_unit_id", sa.Uuid(), nullable=False),
        sa.Column("content_unit_id", sa.Uuid(), nullable=False),
        sa.Column("content_value", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("provenance", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "content_value > 0",
            name=op.f("ck_ingredient_package_sizes_content_value_positive"),
        ),
        sa.CheckConstraint(
            "package_unit_id <> content_unit_id",
            name=op.f("ck_ingredient_package_sizes_units_must_differ"),
        ),
        sa.CheckConstraint(
            "btrim(label) <> ''",
            name=op.f("ck_ingredient_package_sizes_label_not_blank"),
        ),
        sa.CheckConstraint(
            "btrim(provenance) <> ''",
            name=op.f("ck_ingredient_package_sizes_provenance_not_blank"),
        ),
        sa.ForeignKeyConstraint(
            ["ingredient_id"],
            ["ingredients.id"],
            name=op.f("fk_ingredient_package_sizes_ingredient_id_ingredients"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["package_unit_id"],
            ["measurement_units.id"],
            name=op.f("fk_ingredient_package_sizes_package_unit_id_measurement_units"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["content_unit_id"],
            ["measurement_units.id"],
            name=op.f("fk_ingredient_package_sizes_content_unit_id_measurement_units"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingredient_package_sizes")),
        sa.UniqueConstraint(
            "id",
            "ingredient_id",
            "package_unit_id",
            name="uq_ingredient_package_sizes_id_ingredient_unit",
        ),
    )
    op.create_index(
        op.f("ix_ingredient_package_sizes_ingredient_id"),
        "ingredient_package_sizes",
        ["ingredient_id"],
        unique=False,
    )
    op.create_index(
        "uq_ingredient_package_sizes_ingredient_unit_label_normalized",
        "ingredient_package_sizes",
        ["ingredient_id", "package_unit_id", sa.text("lower(btrim(label))")],
        unique=True,
    )


def _seed_measurement_catalog() -> None:
    catalog = load_frozen_measurement_catalog()
    created_at = catalog.metadata.published_at
    units = sa.table(
        "measurement_units",
        sa.column("id", sa.Uuid()),
        sa.column("key", sa.String()),
        sa.column("dimension", sa.String()),
        sa.column("conversion_family", sa.String()),
        sa.column("canonical_label", sa.String()),
        sa.column("plural_label", sa.String()),
        sa.column("symbol", sa.String()),
        sa.column("display_style", sa.String()),
        sa.column("active", sa.Boolean()),
        sa.column("provenance", sa.Text()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    op.bulk_insert(
        units,
        [
            {
                "id": measurement_uuid("unit", unit.key),
                "key": unit.key,
                "dimension": unit.dimension,
                "conversion_family": unit.conversion_family,
                "canonical_label": unit.canonical_label,
                "plural_label": unit.plural_label,
                "symbol": unit.symbol,
                "display_style": unit.display_style,
                "active": unit.active,
                "provenance": unit.provenance,
                "created_at": created_at,
            }
            for unit in catalog.units
        ],
    )

    aliases = sa.table(
        "measurement_unit_aliases",
        sa.column("id", sa.Uuid()),
        sa.column("measurement_unit_id", sa.Uuid()),
        sa.column("alias", sa.String()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    alias_rows = [
        {
            "id": measurement_uuid("unit-alias", f"{unit.key}:{alias.key}"),
            "measurement_unit_id": measurement_uuid("unit", unit.key),
            "alias": alias.alias,
            "created_at": created_at,
        }
        for unit in catalog.units
        for alias in unit.aliases
    ]
    if alias_rows:
        op.bulk_insert(aliases, alias_rows)

    rules = sa.table(
        "measurement_conversion_rules",
        sa.column("unit_id", sa.Uuid()),
        sa.column("base_unit_id", sa.Uuid()),
        sa.column("scale_numerator", sa.BigInteger()),
        sa.column("scale_denominator", sa.BigInteger()),
        sa.column("offset_numerator", sa.BigInteger()),
        sa.column("offset_denominator", sa.BigInteger()),
        sa.column("active", sa.Boolean()),
        sa.column("provenance", sa.Text()),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )
    rule_rows = [
        {
            "unit_id": measurement_uuid("unit", unit.key),
            "base_unit_id": measurement_uuid("unit", unit.conversion.base_unit),
            "scale_numerator": unit.conversion.scale_numerator,
            "scale_denominator": unit.conversion.scale_denominator,
            "offset_numerator": unit.conversion.offset_numerator,
            "offset_denominator": unit.conversion.offset_denominator,
            "active": unit.active,
            "provenance": unit.conversion.provenance,
            "created_at": created_at,
        }
        for unit in catalog.units
        if unit.conversion is not None
    ]
    if rule_rows:
        op.bulk_insert(rules, rule_rows)


def _migrate_recipe_ingredients() -> None:
    op.drop_constraint(
        op.f("ck_recipe_version_ingredients_quantity_positive"),
        "recipe_version_ingredients",
        type_="check",
    )
    op.alter_column(
        "recipe_version_ingredients",
        "quantity",
        new_column_name="quantity_min",
        existing_type=sa.Numeric(precision=12, scale=4),
        existing_nullable=True,
    )
    op.alter_column(
        "recipe_version_ingredients",
        "unit",
        new_column_name="unit_display",
        existing_type=sa.String(length=64),
        existing_nullable=True,
    )
    op.add_column(
        "recipe_version_ingredients",
        sa.Column("measure_mode", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "recipe_version_ingredients",
        sa.Column("quantity_max", sa.Numeric(precision=12, scale=4), nullable=True),
    )
    op.add_column(
        "recipe_version_ingredients",
        sa.Column("measurement_unit_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "recipe_version_ingredients",
        sa.Column("package_size_id", sa.Uuid(), nullable=True),
    )

    connection = op.get_bind()
    catalog = load_frozen_measurement_catalog()
    for unit in catalog.units:
        if unit.dimension not in INGREDIENT_MEASUREMENT_DIMENSIONS:
            continue
        tokens = {
            unit.key,
            unit.canonical_label,
            unit.plural_label,
            *(alias.alias for alias in unit.aliases),
        }
        if unit.symbol is not None:
            tokens.add(unit.symbol)
        for token in sorted({value.strip().casefold() for value in tokens}):
            connection.execute(
                sa.text(
                    """
                    UPDATE recipe_version_ingredients
                    SET measure_mode = 'exact', measurement_unit_id = :unit_id
                    WHERE quantity_min IS NOT NULL
                      AND lower(btrim(unit_display)) = :token
                    """
                ),
                {"unit_id": measurement_uuid("unit", unit.key), "token": token},
            )
    connection.execute(
        sa.text(
            """
            UPDATE recipe_version_ingredients
            SET measure_mode = 'unspecified'
            WHERE quantity_min IS NULL AND unit_display IS NULL
            """
        )
    )
    remaining = connection.scalar(
        sa.text("SELECT count(*) FROM recipe_version_ingredients WHERE measure_mode IS NULL")
    )
    if remaining:
        raise RuntimeError(f"structured-measure backfill left {remaining} legacy rows unmapped")

    op.alter_column(
        "recipe_version_ingredients",
        "measure_mode",
        existing_type=sa.String(length=16),
        nullable=False,
    )
    op.create_foreign_key(
        op.f("fk_recipe_version_ingredients_measurement_unit_id_measurement_units"),
        "recipe_version_ingredients",
        "measurement_units",
        ["measurement_unit_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_recipe_version_ingredients_package_size_ingredient_unit",
        "recipe_version_ingredients",
        "ingredient_package_sizes",
        ["package_size_id", "ingredient_id", "measurement_unit_id"],
        ["id", "ingredient_id", "package_unit_id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        op.f("ix_recipe_version_ingredients_measurement_unit_id"),
        "recipe_version_ingredients",
        ["measurement_unit_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_recipe_version_ingredients_package_size_id"),
        "recipe_version_ingredients",
        ["package_size_id"],
        unique=False,
    )
    op.create_check_constraint(
        op.f("ck_recipe_version_ingredients_measure_shape_valid"),
        "recipe_version_ingredients",
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
    )


def upgrade() -> None:
    connection = op.get_bind()
    report = build_legacy_measurement_audit(connection)
    if report["summary"]["unresolved_rows"]:
        raise RuntimeError(bounded_migration_failure(report))
    _create_measurement_tables()
    _seed_measurement_catalog()
    _migrate_recipe_ingredients()


def _require_reconstructable_measurement_catalog(connection: Connection) -> None:
    """Refuse a downgrade that would discard reviewed post-migration metadata."""

    catalog = load_frozen_measurement_catalog()
    expected_units = {
        (
            measurement_uuid("unit", unit.key),
            unit.key,
            unit.dimension,
            unit.conversion_family,
            unit.canonical_label,
            unit.plural_label,
            unit.symbol,
            unit.display_style,
            unit.active,
            unit.provenance,
        )
        for unit in catalog.units
    }
    actual_units = set(
        connection.execute(
            sa.text(
                """
                SELECT id, key, dimension, conversion_family, canonical_label,
                       plural_label, symbol, display_style, active, provenance
                FROM measurement_units
                """
            )
        ).tuples()
    )
    expected_aliases = {
        (
            measurement_uuid("unit-alias", f"{unit.key}:{alias.key}"),
            measurement_uuid("unit", unit.key),
            alias.alias,
        )
        for unit in catalog.units
        for alias in unit.aliases
    }
    actual_aliases = set(
        connection.execute(
            sa.text("SELECT id, measurement_unit_id, alias FROM measurement_unit_aliases")
        ).tuples()
    )
    expected_rules = {
        (
            measurement_uuid("unit", unit.key),
            measurement_uuid("unit", unit.conversion.base_unit),
            unit.conversion.scale_numerator,
            unit.conversion.scale_denominator,
            unit.conversion.offset_numerator,
            unit.conversion.offset_denominator,
            unit.active,
            unit.conversion.provenance,
        )
        for unit in catalog.units
        if unit.conversion is not None
    }
    actual_rules = set(
        connection.execute(
            sa.text(
                """
                SELECT unit_id, base_unit_id, scale_numerator, scale_denominator,
                       offset_numerator, offset_denominator, active, provenance
                FROM measurement_conversion_rules
                """
            )
        ).tuples()
    )
    density_rows = connection.scalar(sa.text("SELECT count(*) FROM ingredient_density_rules"))
    package_rows = connection.scalar(sa.text("SELECT count(*) FROM ingredient_package_sizes"))

    differences: list[str] = []
    if actual_units != expected_units:
        differences.append("measurement_units")
    if actual_aliases != expected_aliases:
        differences.append("measurement_unit_aliases")
    if actual_rules != expected_rules:
        differences.append("measurement_conversion_rules")
    if density_rows:
        differences.append(f"ingredient_density_rules={density_rows}")
    if package_rows:
        differences.append(f"ingredient_package_sizes={package_rows}")
    if differences:
        raise RuntimeError(
            "structured-measure downgrade refused reviewed catalog data that cannot "
            "be reconstructed by the legacy migration: "
            f"differences={differences}. Export or remove that metadata explicitly "
            "before retrying the downgrade."
        )


def _require_lossless_legacy_unit_snapshots(connection: Connection) -> None:
    """Verify every exact row's retained text preserves its curated identity."""

    token_owners: dict[str, set[UUID]] = {}
    for unit in load_frozen_measurement_catalog().units:
        unit_id = measurement_uuid("unit", unit.key)
        tokens = {
            unit.key,
            unit.canonical_label,
            unit.plural_label,
            *(alias.alias for alias in unit.aliases),
        }
        if unit.symbol is not None:
            tokens.add(unit.symbol)
        for token in tokens:
            token_owners.setdefault(token.strip().casefold(), set()).add(unit_id)

    rows = (
        connection.execute(
            sa.text(
                """
                SELECT id, measurement_unit_id, unit_display
                FROM recipe_version_ingredients
                WHERE measure_mode = 'exact'
                ORDER BY id
                """
            )
        )
        .mappings()
        .all()
    )
    mismatches = [
        row
        for row in rows
        if not isinstance(row["unit_display"], str)
        or token_owners.get(row["unit_display"].strip().casefold(), set())
        != {row["measurement_unit_id"]}
    ]
    if mismatches:
        examples = [str(row["id"]) for row in mismatches[:10]]
        raise RuntimeError(
            "structured-measure downgrade refused exact rows whose retained unit text "
            "does not preserve the curated unit identity: "
            f"count={len(mismatches)}, example_row_ids={examples}"
        )


def downgrade() -> None:
    connection = op.get_bind()
    incompatible = (
        connection.execute(
            sa.text(
                """
            SELECT id, measure_mode
            FROM recipe_version_ingredients
            WHERE measure_mode NOT IN ('exact', 'unspecified')
               OR quantity_max IS NOT NULL
               OR package_size_id IS NOT NULL
            ORDER BY id
            LIMIT 11
            """
            )
        )
        .mappings()
        .all()
    )
    if incompatible:
        examples = [str(row["id"]) for row in incompatible[:10]]
        raise RuntimeError(
            "structured-measure downgrade refused rows that cannot be represented "
            f"losslessly: at_least={len(incompatible)}, example_row_ids={examples}"
        )
    _require_reconstructable_measurement_catalog(connection)
    _require_lossless_legacy_unit_snapshots(connection)

    op.drop_constraint(
        op.f("ck_recipe_version_ingredients_measure_shape_valid"),
        "recipe_version_ingredients",
        type_="check",
    )
    op.drop_index(
        op.f("ix_recipe_version_ingredients_package_size_id"),
        table_name="recipe_version_ingredients",
    )
    op.drop_index(
        op.f("ix_recipe_version_ingredients_measurement_unit_id"),
        table_name="recipe_version_ingredients",
    )
    op.drop_constraint(
        "fk_recipe_version_ingredients_package_size_ingredient_unit",
        "recipe_version_ingredients",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_recipe_version_ingredients_measurement_unit_id_measurement_units"),
        "recipe_version_ingredients",
        type_="foreignkey",
    )
    op.drop_column("recipe_version_ingredients", "package_size_id")
    op.drop_column("recipe_version_ingredients", "measurement_unit_id")
    op.drop_column("recipe_version_ingredients", "quantity_max")
    op.drop_column("recipe_version_ingredients", "measure_mode")
    op.alter_column(
        "recipe_version_ingredients",
        "unit_display",
        new_column_name="unit",
        existing_type=sa.String(length=64),
        existing_nullable=True,
    )
    op.alter_column(
        "recipe_version_ingredients",
        "quantity_min",
        new_column_name="quantity",
        existing_type=sa.Numeric(precision=12, scale=4),
        existing_nullable=True,
    )
    op.create_check_constraint(
        op.f("ck_recipe_version_ingredients_quantity_positive"),
        "recipe_version_ingredients",
        "quantity IS NULL OR quantity > 0",
    )

    op.drop_index(
        "uq_ingredient_package_sizes_ingredient_unit_label_normalized",
        table_name="ingredient_package_sizes",
    )
    op.drop_index(
        op.f("ix_ingredient_package_sizes_ingredient_id"),
        table_name="ingredient_package_sizes",
    )
    op.drop_table("ingredient_package_sizes")
    op.drop_index(
        op.f("ix_ingredient_density_rules_ingredient_id"),
        table_name="ingredient_density_rules",
    )
    op.drop_table("ingredient_density_rules")
    op.drop_index(
        op.f("ix_measurement_conversion_rules_base_unit_id"),
        table_name="measurement_conversion_rules",
    )
    op.drop_table("measurement_conversion_rules")
    op.drop_index(
        "uq_measurement_unit_aliases_alias_normalized",
        table_name="measurement_unit_aliases",
    )
    op.drop_index(
        op.f("ix_measurement_unit_aliases_measurement_unit_id"),
        table_name="measurement_unit_aliases",
    )
    op.drop_table("measurement_unit_aliases")
    op.drop_index("ix_measurement_units_active_dimension", table_name="measurement_units")
    op.drop_index(
        "uq_measurement_units_canonical_label_normalized",
        table_name="measurement_units",
    )
    op.drop_index("uq_measurement_units_key_normalized", table_name="measurement_units")
    op.drop_table("measurement_units")
