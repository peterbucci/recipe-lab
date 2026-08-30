from decimal import Decimal
from hashlib import sha256
from uuid import UUID, uuid4

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import Connection, Engine
from sqlalchemy.orm import Session

from app.models import (
    Ingredient,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeLineage,
    RecipeVersion,
)
from app.seeds.identifiers import action_uuid, measurement_uuid
from app.services.recipe_fingerprints import STRUCTURAL_FINGERPRINT_STORAGE_VERSION

_CONTENT_TABLES_AND_ORDER = (
    ("recipe_versions", "id"),
    ("recipe_version_ingredients", "id"),
    ("recipe_version_instructions", "id"),
    ("recipe_instruction_actions", "id"),
    ("recipe_instruction_action_inputs", "id"),
    (
        "recipe_instruction_action_measures",
        "recipe_instruction_action_id, semantic",
    ),
)


def _recipe_content_snapshot(connection: Connection) -> dict[str, list[tuple[object, ...]]]:
    return {
        table_name: list(
            connection.execute(sa.text(f"SELECT * FROM {table_name} ORDER BY {order_by}")).tuples()
        )
        for table_name, order_by in _CONTENT_TABLES_AND_ORDER
    }


def _load_complete_and_incomplete_versions(connection: Connection) -> tuple[UUID, UUID]:
    with (
        Session(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        ) as session,
        session.begin(),
    ):
        user_id = uuid4()
        session.execute(
            sa.text(
                "INSERT INTO users "
                "(id, email, display_name, account_kind, status) "
                "VALUES (:id, :email, 'Fingerprint migration', 'member', 'active')"
            ),
            {
                "id": user_id,
                "email": f"incomplete-fingerprint-{uuid4()}@example.test",
            },
        )
        ingredient = Ingredient(canonical_name=f"Migration ingredient {uuid4()}")
        session.add(ingredient)
        session.flush()

        complete_lineage = RecipeLineage(created_by_user_id=user_id)
        session.add(complete_lineage)
        session.flush()
        complete = RecipeVersion(
            lineage_id=complete_lineage.id,
            parent_version_id=None,
            created_by_user_id=user_id,
            version_number=1,
            title="Mapped recipe",
            description="This prose is outside the fingerprint.",
            servings=Decimal("1.00"),
        )
        session.add(complete)
        session.flush()
        recipe_ingredient = RecipeIngredient(
            recipe_version_id=complete.id,
            ingredient_id=ingredient.id,
            name=ingredient.canonical_name,
            measure_mode="exact",
            quantity_min=Decimal("100.0000"),
            quantity_max=None,
            measurement_unit_id=measurement_uuid("unit", "g"),
            unit_display="g",
            package_size_id=None,
            preparation_notes="Display-only preparation prose.",
            display_order=0,
        )
        instruction = RecipeInstruction(
            recipe_version_id=complete.id,
            instruction="Mix the ingredient.",
            display_order=0,
        )
        session.add_all([recipe_ingredient, instruction])
        session.flush()
        action = RecipeInstructionAction(
            recipe_version_id=complete.id,
            recipe_instruction_id=instruction.id,
            action_type_id=action_uuid("action-type", "mix"),
            display_order=0,
        )
        session.add(action)
        session.flush()
        session.add(
            RecipeInstructionActionInput(
                recipe_version_id=complete.id,
                recipe_instruction_action_id=action.id,
                recipe_ingredient_id=recipe_ingredient.id,
                display_order=0,
            )
        )

        incomplete_lineage = RecipeLineage(created_by_user_id=user_id)
        session.add(incomplete_lineage)
        session.flush()
        incomplete = RecipeVersion(
            lineage_id=incomplete_lineage.id,
            parent_version_id=None,
            created_by_user_id=user_id,
            version_number=1,
            title="Unmapped legacy recipe",
            description="No reviewed structural rows.",
            servings=Decimal("1.00"),
        )
        session.add(incomplete)
        session.flush()
        return complete.id, incomplete.id


def _stored_fingerprints(connection: Connection) -> list[tuple[object, ...]]:
    return list(
        connection.execute(
            sa.text(
                """
                SELECT recipe_version_id, algorithm_version, digest, canonical_payload
                FROM recipe_structural_fingerprints
                ORDER BY recipe_version_id, algorithm_version
                """
            )
        ).tuples()
    )


def test_migration_backfills_only_complete_versions_without_mutating_content(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260824_0010")
        complete_id, incomplete_id = _load_complete_and_incomplete_versions(connection)
        before = _recipe_content_snapshot(connection)

        command.upgrade(alembic_config, "head")

        assert MigrationContext.configure(connection).get_current_revision() == ("20260830_0021")
        stored = _stored_fingerprints(connection)
        assert len(stored) == 1
        assert stored[0][0] == complete_id
        assert incomplete_id not in {row[0] for row in stored}
        assert {row[1] for row in stored} == {STRUCTURAL_FINGERPRINT_STORAGE_VERSION}
        for row in stored:
            canonical_payload = row[3]
            assert isinstance(canonical_payload, str)
            assert row[2] == sha256(canonical_payload.encode("utf-8")).hexdigest()
        assert _recipe_content_snapshot(connection) == before

        index_is_unique = connection.scalar(
            sa.text(
                """
                SELECT index_definition.indisunique
                FROM pg_class table_definition
                JOIN pg_index index_definition
                  ON index_definition.indrelid = table_definition.oid
                JOIN pg_class index_name
                  ON index_name.oid = index_definition.indexrelid
                WHERE table_definition.relname = 'recipe_structural_fingerprints'
                  AND index_name.relname =
                      'ix_recipe_structural_fingerprints_algorithm_digest'
                """
            )
        )
        assert index_is_unique is False


def test_migration_backfill_is_reproducible_across_downgrade_and_upgrade(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260824_0010")
        _load_complete_and_incomplete_versions(connection)
        before = _recipe_content_snapshot(connection)

        command.upgrade(alembic_config, "head")
        first = _stored_fingerprints(connection)
        command.downgrade(alembic_config, "20260824_0010")
        assert _recipe_content_snapshot(connection) == before
        command.upgrade(alembic_config, "head")
        second = _stored_fingerprints(connection)

        assert second == first
        assert _recipe_content_snapshot(connection) == before
