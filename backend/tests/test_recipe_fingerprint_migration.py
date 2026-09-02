from hashlib import sha256
from uuid import UUID

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, Engine

from migrations.frozen.catalog_20260824 import action_uuid, measurement_uuid
from migrations.frozen.recipe_fingerprints_0011 import (
    STRUCTURAL_FINGERPRINT_STORAGE_VERSION,
)

_USER_ID = UUID("00000000-0000-0000-0000-000000000101")
_COMPLETE_LINEAGE_ID = UUID("00000000-0000-0000-0000-000000000102")
_INCOMPLETE_LINEAGE_ID = UUID("00000000-0000-0000-0000-000000000103")
_COMPLETE_VERSION_ID = UUID("00000000-0000-0000-0000-000000000110")
_INCOMPLETE_VERSION_ID = UUID("00000000-0000-0000-0000-000000000111")
_INGREDIENT_ID = UUID("00000000-0000-0000-0000-000000000112")
_RECIPE_INGREDIENT_ID = UUID("00000000-0000-0000-0000-000000000113")
_INSTRUCTION_ID = UUID("00000000-0000-0000-0000-000000000114")
_ACTION_ID = UUID("00000000-0000-0000-0000-000000000115")

_EXPECTED_CANONICAL_PAYLOAD = (
    '{"ingredients":[{"ingredient":"00000000-0000-0000-0000-000000000112",'
    '"measure":{"mode":"exact","unit":{"dimension":"mass",'
    '"family":"metric-mass","key":"g","normalization":"reviewed_base"},'
    '"value":{"denominator":1,"numerator":100}},"multiplicity":1,'
    '"occurrences":["ingredient:0000"]}],"instructions":[{"actions":'
    '[{"action":"mix","inputs":["ingredient:0000"],"parameters":[]}]}],'
    '"schema":"recipe-lab.recipe-structure","version":1}'
)
_EXPECTED_DIGEST = "2f04d99487dd7667ca41049fb4ebcc807fc82d32da29feb2d4a03a8558dc1117"

_CONTENT_TABLES_AND_ORDER = (
    (
        "recipe_versions",
        "lineage_id, parent_version_id, created_by_user_id, version_number, "
        "title, description, servings, id, created_at",
        "id",
    ),
    (
        "recipe_version_ingredients",
        "recipe_version_id, name, quantity_min, unit_display, preparation_notes, "
        "display_order, id, ingredient_id, measure_mode, quantity_max, "
        "measurement_unit_id, package_size_id",
        "id",
    ),
    (
        "recipe_version_instructions",
        "recipe_version_id, instruction, display_order, id",
        "id",
    ),
    (
        "recipe_instruction_actions",
        "id, recipe_version_id, recipe_instruction_id, action_type_id, display_order",
        "id",
    ),
    (
        "recipe_instruction_action_inputs",
        "id, recipe_version_id, recipe_instruction_action_id, recipe_ingredient_id, display_order",
        "id",
    ),
    (
        "recipe_instruction_action_measures",
        "recipe_instruction_action_id, semantic, measure_mode, quantity_min, "
        "quantity_max, measurement_unit_id, unit_display",
        "recipe_instruction_action_id, semantic",
    ),
)


def _recipe_content_snapshot(connection: Connection) -> dict[str, list[tuple[object, ...]]]:
    return {
        table_name: list(
            connection.execute(
                sa.text(f"SELECT {columns} FROM {table_name} ORDER BY {order_by}")
            ).tuples()
        )
        for table_name, columns, order_by in _CONTENT_TABLES_AND_ORDER
    }


def _load_complete_and_incomplete_versions(connection: Connection) -> tuple[UUID, UUID]:
    connection.execute(
        sa.text(
            """
            INSERT INTO users (id, email, display_name, account_kind, status)
            VALUES (:id, 'fingerprint-migration@example.test',
                    'Fingerprint migration', 'member', 'active')
            """
        ),
        {"id": _USER_ID},
    )
    connection.execute(
        sa.text("INSERT INTO ingredients (id, canonical_name) VALUES (:id, :name)"),
        {"id": _INGREDIENT_ID, "name": "Migration ingredient"},
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO recipe_lineages (id, created_by_user_id)
            VALUES (:complete_id, :user_id), (:incomplete_id, :user_id)
            """
        ),
        {
            "complete_id": _COMPLETE_LINEAGE_ID,
            "incomplete_id": _INCOMPLETE_LINEAGE_ID,
            "user_id": _USER_ID,
        },
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO recipe_versions
                (id, lineage_id, parent_version_id, created_by_user_id,
                 version_number, title, description, servings)
            VALUES
                (:complete_id, :complete_lineage_id, NULL, :user_id, 1,
                 'Mapped recipe', 'This prose is outside the fingerprint.', 1.00),
                (:incomplete_id, :incomplete_lineage_id, NULL, :user_id, 1,
                 'Unmapped legacy recipe', 'No reviewed structural rows.', 1.00)
            """
        ),
        {
            "complete_id": _COMPLETE_VERSION_ID,
            "complete_lineage_id": _COMPLETE_LINEAGE_ID,
            "incomplete_id": _INCOMPLETE_VERSION_ID,
            "incomplete_lineage_id": _INCOMPLETE_LINEAGE_ID,
            "user_id": _USER_ID,
        },
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO recipe_version_ingredients
                (id, recipe_version_id, ingredient_id, name, measure_mode,
                 quantity_min, quantity_max, measurement_unit_id, unit_display,
                 package_size_id, preparation_notes, display_order)
            VALUES
                (:id, :version_id, :ingredient_id, 'Migration ingredient', 'exact',
                 100.0000, NULL, :unit_id, 'g', NULL,
                 'Display-only preparation prose.', 0)
            """
        ),
        {
            "id": _RECIPE_INGREDIENT_ID,
            "version_id": _COMPLETE_VERSION_ID,
            "ingredient_id": _INGREDIENT_ID,
            "unit_id": measurement_uuid("unit", "g"),
        },
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO recipe_version_instructions
                (id, recipe_version_id, instruction, display_order)
            VALUES (:id, :version_id, 'Mix the ingredient.', 0)
            """
        ),
        {"id": _INSTRUCTION_ID, "version_id": _COMPLETE_VERSION_ID},
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO recipe_instruction_actions
                (id, recipe_version_id, recipe_instruction_id, action_type_id, display_order)
            VALUES (:id, :version_id, :instruction_id, :action_type_id, 0)
            """
        ),
        {
            "id": _ACTION_ID,
            "version_id": _COMPLETE_VERSION_ID,
            "instruction_id": _INSTRUCTION_ID,
            "action_type_id": action_uuid("action-type", "mix"),
        },
    )
    connection.execute(
        sa.text(
            """
            INSERT INTO recipe_instruction_action_inputs
                (id, recipe_version_id, recipe_instruction_action_id,
                 recipe_ingredient_id, display_order)
            VALUES (:id, :version_id, :action_id, :ingredient_id, 0)
            """
        ),
        {
            "id": UUID("00000000-0000-0000-0000-000000000116"),
            "version_id": _COMPLETE_VERSION_ID,
            "action_id": _ACTION_ID,
            "ingredient_id": _RECIPE_INGREDIENT_ID,
        },
    )
    return _COMPLETE_VERSION_ID, _INCOMPLETE_VERSION_ID


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

        expected_head = ScriptDirectory.from_config(alembic_config).get_current_head()
        assert MigrationContext.configure(connection).get_current_revision() == expected_head
        stored = _stored_fingerprints(connection)
        assert len(stored) == 1
        assert stored[0][0] == complete_id
        assert incomplete_id not in {row[0] for row in stored}
        assert {row[1] for row in stored} == {STRUCTURAL_FINGERPRINT_STORAGE_VERSION}
        assert stored[0][2] == _EXPECTED_DIGEST
        assert stored[0][3] == _EXPECTED_CANONICAL_PAYLOAD
        assert stored[0][2] == sha256(stored[0][3].encode("utf-8")).hexdigest()
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
