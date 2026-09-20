"""Allow incomplete ingredient amounts and instruction text in private drafts.

Revision ID: 20260919_0036
Revises: 20260916_0035
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260919_0036"
down_revision: str | None = "20260916_0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MEASURE_CONSTRAINT = "ck_recipe_draft_ingredients_measure_shape_valid"
_INSTRUCTION_CONSTRAINT = "ck_recipe_draft_instructions_instruction_not_blank"

_COMPLETE_OR_EMPTY_MEASURE = (
    "(measure_mode IS NULL "
    "AND quantity_min IS NULL AND quantity_max IS NULL "
    "AND measurement_unit_id IS NULL AND unit_display IS NULL "
    "AND package_size_id IS NULL) "
    "OR (measure_mode IS NOT NULL AND measure_mode = 'exact' "
    "AND quantity_min IS NOT NULL AND quantity_min > 0 "
    "AND quantity_max IS NULL "
    "AND measurement_unit_id IS NOT NULL "
    "AND NULLIF(btrim(unit_display), '') IS NOT NULL) "
    "OR (measure_mode IS NOT NULL AND measure_mode = 'range' "
    "AND quantity_min IS NOT NULL AND quantity_min > 0 "
    "AND quantity_max IS NOT NULL AND quantity_max > quantity_min "
    "AND measurement_unit_id IS NOT NULL "
    "AND NULLIF(btrim(unit_display), '') IS NOT NULL) "
    "OR (measure_mode IS NOT NULL "
    "AND measure_mode IN ('to_taste', 'as_needed', 'unspecified') "
    "AND quantity_min IS NULL AND quantity_max IS NULL "
    "AND measurement_unit_id IS NULL AND unit_display IS NULL "
    "AND package_size_id IS NULL)"
)

_COMPLETE_MEASURE = (
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
    "AND package_size_id IS NULL)"
)


def upgrade() -> None:
    op.drop_constraint(
        op.f(_MEASURE_CONSTRAINT),
        "recipe_draft_ingredients",
        type_="check",
    )
    op.alter_column(
        "recipe_draft_ingredients",
        "measure_mode",
        existing_type=sa.String(length=16),
        nullable=True,
    )
    op.create_check_constraint(
        op.f(_MEASURE_CONSTRAINT),
        "recipe_draft_ingredients",
        _COMPLETE_OR_EMPTY_MEASURE,
    )
    op.drop_constraint(
        op.f(_INSTRUCTION_CONSTRAINT),
        "recipe_draft_instructions",
        type_="check",
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(
        sa.text(
            "SELECT EXISTS ("
            "SELECT 1 FROM recipe_draft_ingredients WHERE measure_mode IS NULL "
            "UNION ALL "
            "SELECT 1 FROM recipe_draft_instructions WHERE btrim(instruction) = ''"
            ")"
        )
    ):
        raise RuntimeError(
            "cannot downgrade private draft completeness while incomplete rows exist"
        )

    op.create_check_constraint(
        op.f(_INSTRUCTION_CONSTRAINT),
        "recipe_draft_instructions",
        "btrim(instruction) <> ''",
    )
    op.drop_constraint(
        op.f(_MEASURE_CONSTRAINT),
        "recipe_draft_ingredients",
        type_="check",
    )
    op.alter_column(
        "recipe_draft_ingredients",
        "measure_mode",
        existing_type=sa.String(length=16),
        nullable=False,
    )
    op.create_check_constraint(
        op.f(_MEASURE_CONSTRAINT),
        "recipe_draft_ingredients",
        _COMPLETE_MEASURE,
    )
