from decimal import Decimal
from hashlib import sha256
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Connection, Engine, inspect
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

from app.core.demo_identity import DEMO_USER_DISPLAY_NAME, DEMO_USER_EMAIL, DEMO_USER_ID
from app.measurement_audit import build_legacy_measurement_audit
from app.repositories.recipes import browse_recipe_versions
from app.seeds.catalog import load_bundled_catalog
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.services.recipe_responses import recipe_summary_response
from migrations.frozen.catalog_20260824 import (
    action_uuid as frozen_action_uuid,
)
from migrations.frozen.catalog_20260824 import (
    load_frozen_action_backfill_catalog,
)
from migrations.frozen.catalog_20260824 import (
    measurement_uuid as frozen_measurement_uuid,
)
from migrations.frozen.catalog_20260824 import (
    seed_uuid as frozen_seed_uuid,
)

DOMAIN_TABLES = {
    "abuse_rate_limit_buckets",
    "allergens",
    "catalog_curators",
    "community_moderators",
    "cooking_action_types",
    "dietary_flags",
    "ingredient_aliases",
    "ingredient_catalog_audit_events",
    "ingredient_catalog_names",
    "ingredient_catalog_requests",
    "ingredient_allergens",
    "ingredient_categories",
    "ingredient_dietary_flags",
    "ingredient_density_rules",
    "ingredient_package_sizes",
    "ingredient_substitutions",
    "ingredients",
    "measurement_conversion_rules",
    "measurement_unit_aliases",
    "measurement_units",
    "oidc_identities",
    "oidc_login_transactions",
    "preference_events",
    "recipe_lineages",
    "recipe_moderation_audit_events",
    "recipe_moderation_cases",
    "recipe_reports",
    "recipe_duplicate_candidates",
    "recipe_duplicate_decisions",
    "recipe_duplicate_preflights",
    "recipe_draft_ingredients",
    "recipe_draft_categories",
    "recipe_draft_instruction_action_inputs",
    "recipe_draft_instruction_action_measures",
    "recipe_draft_instruction_actions",
    "recipe_draft_instructions",
    "recipe_drafts",
    "recipe_instruction_action_inputs",
    "recipe_instruction_action_measures",
    "recipe_instruction_actions",
    "recipe_ratings",
    "recipe_saves",
    "user_follows",
    "recipe_structural_fingerprints",
    "recipe_version_ingredients",
    "recipe_version_categories",
    "recipe_version_instructions",
    "recipe_version_publications",
    "recipe_version_visibility_events",
    "recipe_versions",
    "recipe_categories",
    "users",
    "user_sessions",
}

INGREDIENT_TABLES = {
    "allergens",
    "dietary_flags",
    "ingredient_aliases",
    "ingredient_catalog_names",
    "ingredient_allergens",
    "ingredient_categories",
    "ingredient_dietary_flags",
    "ingredient_density_rules",
    "ingredient_package_sizes",
    "ingredient_substitutions",
    "ingredients",
    "measurement_conversion_rules",
    "measurement_unit_aliases",
    "measurement_units",
}


def _insert_legacy_recipe_rows(
    connection: Connection,
    rows: list[tuple[str, Decimal | None, str | None]],
) -> tuple[UUID, list[UUID]]:
    user_id = uuid4()
    lineage_id = uuid4()
    version_id = uuid4()
    row_ids = [uuid4() for _ in rows]
    metadata = sa.MetaData()
    users = sa.Table("users", metadata, autoload_with=connection)
    lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
    versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
    recipe_ingredients = sa.Table(
        "recipe_version_ingredients",
        metadata,
        autoload_with=connection,
    )
    connection.execute(
        users.insert().values(
            id=user_id,
            email=f"legacy-{user_id}@example.com",
            display_name="Legacy Measurement Migration",
        )
    )
    connection.execute(lineages.insert().values(id=lineage_id, created_by_user_id=user_id))
    connection.execute(
        versions.insert().values(
            id=version_id,
            lineage_id=lineage_id,
            parent_version_id=None,
            created_by_user_id=user_id,
            version_number=1,
            title="Legacy Measurement Recipe",
            description=None,
            servings=Decimal("4.00"),
        )
    )
    connection.execute(
        recipe_ingredients.insert(),
        [
            {
                "id": row_id,
                "recipe_version_id": version_id,
                "name": name,
                "quantity": quantity,
                "unit": unit,
                "preparation_notes": None,
                "display_order": display_order,
            }
            for display_order, (row_id, (name, quantity, unit)) in enumerate(
                zip(row_ids, rows, strict=True)
            )
        ],
    )
    return version_id, row_ids


def test_migrations_round_trip_on_empty_postgres_schema(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    script = ScriptDirectory.from_config(alembic_config)

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        command.check(alembic_config)
        current_revision = MigrationContext.configure(connection).get_current_revision()

    assert current_revision == script.get_current_head()
    upgraded_inspector = inspect(empty_postgres_engine)
    assert DOMAIN_TABLES <= set(upgraded_inspector.get_table_names())
    ingredient_columns = {
        column["name"]: column
        for column in upgraded_inspector.get_columns("recipe_version_ingredients")
    }
    assert ingredient_columns["ingredient_id"]["nullable"] is False
    assert ingredient_columns["measure_mode"]["nullable"] is False
    action_input_foreign_keys = {
        foreign_key["name"]: (
            tuple(foreign_key["constrained_columns"]),
            tuple(foreign_key["referred_columns"]),
        )
        for foreign_key in upgraded_inspector.get_foreign_keys("recipe_instruction_action_inputs")
    }
    assert action_input_foreign_keys[
        "fk_recipe_instruction_action_inputs_ingredient_same_version"
    ] == (
        ("recipe_version_id", "recipe_ingredient_id"),
        ("recipe_version_id", "id"),
    )
    quantity_min_type = ingredient_columns["quantity_min"]["type"]
    quantity_max_type = ingredient_columns["quantity_max"]["type"]
    unit_display_type = ingredient_columns["unit_display"]["type"]
    assert isinstance(quantity_min_type, sa.Numeric)
    assert isinstance(quantity_max_type, sa.Numeric)
    assert isinstance(unit_display_type, sa.String)
    assert quantity_min_type.precision == 12
    assert quantity_min_type.scale == 4
    assert quantity_max_type.precision == 12
    assert quantity_max_type.scale == 4
    assert ingredient_columns["measurement_unit_id"]["nullable"] is True
    assert unit_display_type.length == 64
    assert ingredient_columns["package_size_id"]["nullable"] is True
    assert "quantity" not in ingredient_columns
    assert "unit" not in ingredient_columns
    ingredient_foreign_keys = upgraded_inspector.get_foreign_keys("recipe_version_ingredients")
    assert any(
        foreign_key["constrained_columns"] == ["ingredient_id"]
        and foreign_key["referred_table"] == "ingredients"
        and foreign_key["referred_columns"] == ["id"]
        for foreign_key in ingredient_foreign_keys
    )
    assert any(
        foreign_key["constrained_columns"] == ["measurement_unit_id"]
        and foreign_key["referred_table"] == "measurement_units"
        and foreign_key["referred_columns"] == ["id"]
        for foreign_key in ingredient_foreign_keys
    )
    assert any(
        foreign_key["constrained_columns"]
        == ["package_size_id", "ingredient_id", "measurement_unit_id"]
        and foreign_key["referred_table"] == "ingredient_package_sizes"
        and foreign_key["referred_columns"] == ["id", "ingredient_id", "package_unit_id"]
        for foreign_key in ingredient_foreign_keys
    )

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.downgrade(alembic_config, "base")

    assert DOMAIN_TABLES.isdisjoint(inspect(empty_postgres_engine).get_table_names())

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        current_revision = MigrationContext.configure(connection).get_current_revision()

    assert current_revision == script.get_current_head()
    assert DOMAIN_TABLES <= set(inspect(empty_postgres_engine).get_table_names())


def test_catalog_name_namespace_migration_backfills_normalized_canonical_and_alias_rows(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    ingredient_id = uuid4()
    alias_id = uuid4()
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260902_0027")
        connection.execute(
            sa.text(
                "INSERT INTO ingredients (id, canonical_name) "
                "VALUES (:ingredient_id, :canonical_name)"
            ),
            {
                "ingredient_id": ingredient_id,
                "canonical_name": "Ｃｈｉｃｋｐｅａ",
            },
        )
        connection.execute(
            sa.text(
                "INSERT INTO ingredient_aliases (id, ingredient_id, alias) "
                "VALUES (:alias_id, :ingredient_id, :alias)"
            ),
            {
                "alias_id": alias_id,
                "ingredient_id": ingredient_id,
                "alias": "Garbanzo\t beans",
            },
        )
        command.upgrade(alembic_config, "head")
        rows = connection.execute(
            sa.text(
                "SELECT name_kind, display_name, normalized_name, "
                "normalized_name_digest, canonical_ingredient_id, ingredient_alias_id "
                "FROM ingredient_catalog_names ORDER BY name_kind"
            )
        ).mappings()
        namespace_rows = [dict(row) for row in rows]

    expected = {
        "alias": ("Garbanzo\t beans", "garbanzo beans", alias_id),
        "canonical": ("Ｃｈｉｃｋｐｅａ", "chickpea", ingredient_id),
    }
    assert len(namespace_rows) == 2
    for row in namespace_rows:
        display_name, normalized_name, source_id = expected[row["name_kind"]]
        assert row["display_name"] == display_name
        assert row["normalized_name"] == normalized_name
        assert row["normalized_name_digest"] == sha256(normalized_name.encode("utf-8")).hexdigest()
        if row["name_kind"] == "canonical":
            assert row["canonical_ingredient_id"] == source_id
            assert row["ingredient_alias_id"] is None
        else:
            assert row["canonical_ingredient_id"] is None
            assert row["ingredient_alias_id"] == source_id

    indexes = {
        index["name"]: index
        for index in inspect(empty_postgres_engine).get_indexes("ingredient_catalog_names")
    }
    assert indexes["uq_ingredient_catalog_names_normalized_digest"]["unique"] is True
    assert indexes["uq_ingredient_catalog_names_normalized_digest"]["column_names"] == [
        "normalized_name_digest"
    ]


def test_catalog_name_namespace_migration_refuses_cross_kind_normalized_collisions(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    canonical_id = uuid4()
    alias_owner_id = uuid4()
    alias_id = uuid4()
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260902_0027")
        connection.execute(
            sa.text(
                "INSERT INTO ingredients (id, canonical_name) VALUES "
                "(:canonical_id, 'ＣＨＩＣＫＰＥＡ'), (:alias_owner_id, 'Other ingredient')"
            ),
            {
                "canonical_id": canonical_id,
                "alias_owner_id": alias_owner_id,
            },
        )
        connection.execute(
            sa.text(
                "INSERT INTO ingredient_aliases (id, ingredient_id, alias) "
                "VALUES (:alias_id, :alias_owner_id, 'chickpea')"
            ),
            {"alias_id": alias_id, "alias_owner_id": alias_owner_id},
        )

    with pytest.raises(RuntimeError, match="normalized catalog name collision"):
        with empty_postgres_engine.begin() as connection:
            alembic_config.attributes["connection"] = connection
            command.upgrade(alembic_config, "head")

    with empty_postgres_engine.connect() as connection:
        assert MigrationContext.configure(connection).get_current_revision() == "20260902_0027"
    assert "ingredient_catalog_names" not in inspect(empty_postgres_engine).get_table_names()


def test_recipe_category_migration_uses_only_explicit_demo_assignments(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    catalog = load_bundled_catalog()
    recipe_key = "carrot-walnut-snack-cake-v1"
    seeded_version_id = seed_uuid(catalog.metadata.dataset_id, "recipe-version", recipe_key)
    unrelated_version_id = uuid4()
    author_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260828_0020")

        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=connection)
        lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
        versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
        connection.execute(
            users.insert().values(
                id=author_id,
                email=f"category-migration-{author_id}@example.test",
                display_name="Category migration test",
                handle=f"category_migration_{author_id.hex[:8]}",
            )
        )
        seeded_lineage_id = uuid4()
        unrelated_lineage_id = uuid4()
        connection.execute(
            lineages.insert(),
            [
                {"id": seeded_lineage_id, "created_by_user_id": author_id},
                {"id": unrelated_lineage_id, "created_by_user_id": author_id},
            ],
        )
        connection.execute(
            versions.insert(),
            [
                {
                    "id": seeded_version_id,
                    "lineage_id": seeded_lineage_id,
                    "parent_version_id": None,
                    "created_by_user_id": author_id,
                    "version_number": 1,
                    "title": "Explicitly mapped demo identity",
                    "description": None,
                    "servings": Decimal("4.00"),
                },
                {
                    "id": unrelated_version_id,
                    "lineage_id": unrelated_lineage_id,
                    "parent_version_id": None,
                    "created_by_user_id": author_id,
                    "version_number": 1,
                    "title": "Carrot dessert words do not imply a category",
                    "description": "Breakfast dinner bread vegetarian quick easy",
                    "servings": Decimal("4.00"),
                },
            ],
        )

        command.upgrade(alembic_config, "head")

        mapped = [
            tuple(row)
            for row in connection.execute(
                sa.text(
                    "SELECT category_name, category_slug, display_order "
                    "FROM recipe_version_categories "
                    "WHERE recipe_version_id = :recipe_version_id "
                    "ORDER BY display_order"
                ),
                {"recipe_version_id": seeded_version_id},
            )
        ]
        inferred = connection.scalar(
            sa.text(
                "SELECT count(*) FROM recipe_version_categories "
                "WHERE recipe_version_id = :recipe_version_id"
            ),
            {"recipe_version_id": unrelated_version_id},
        )
        vocabulary = [
            tuple(row)
            for row in connection.execute(
                sa.text(
                    "SELECT name, slug, display_order FROM recipe_categories "
                    "WHERE active IS TRUE ORDER BY display_order"
                )
            )
        ]

        assert mapped == [("Desserts", "desserts", 0), ("Vegetarian", "vegetarian", 1)]
        assert inferred == 0
        assert vocabulary == [
            ("Breakfast", "breakfast", 0),
            ("Lunch", "lunch", 1),
            ("Dinner", "dinner", 2),
            ("Desserts", "desserts", 3),
            ("Breads", "breads", 4),
            ("Vegetarian", "vegetarian", 5),
            ("Quick & Easy", "quick-easy", 6),
        ]

        with (
            pytest.raises(IntegrityError, match="category snapshots are immutable"),
            connection.begin_nested(),
        ):
            connection.execute(
                sa.text(
                    "UPDATE recipe_version_categories SET category_name = 'Changed' "
                    "WHERE recipe_version_id = :recipe_version_id"
                ),
                {"recipe_version_id": seeded_version_id},
            )

        publications = sa.Table(
            "recipe_version_publications",
            sa.MetaData(),
            autoload_with=connection,
        )
        connection.execute(
            publications.insert().values(
                recipe_version_id=unrelated_version_id,
                actor_user_id=author_id,
            )
        )
        breakfast_id = seed_uuid(
            catalog.metadata.dataset_id,
            "recipe-category",
            "breakfast",
        )
        with (
            pytest.raises(IntegrityError, match="published recipe category snapshots"),
            connection.begin_nested(),
        ):
            connection.execute(
                sa.text(
                    "INSERT INTO recipe_version_categories "
                    "(recipe_version_id, recipe_category_id, category_name, category_slug, "
                    "display_order) VALUES (:version_id, :category_id, 'Breakfast', "
                    "'breakfast', 0)"
                ),
                {
                    "version_id": unrelated_version_id,
                    "category_id": breakfast_id,
                },
            )


def test_original_publication_backfills_visibility_and_seals_existing_snapshots(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    user_id = uuid4()
    lineage_id = uuid4()
    version_id = uuid4()
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260825_0013")
        parameters = {
            "user_id": user_id,
            "email": f"migration-{user_id}@example.test",
            "handle": f"migration_{user_id.hex[:12]}",
            "lineage_id": lineage_id,
            "version_id": version_id,
        }
        connection.execute(
            sa.text(
                """
                INSERT INTO users (
                    id, email, display_name, handle, account_kind, status,
                    created_at, updated_at
                ) VALUES (
                    :user_id, :email, 'Migration Author', :handle, 'member', 'active',
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                """
            ),
            parameters,
        )
        connection.execute(
            sa.text(
                """
                INSERT INTO recipe_lineages (id, created_by_user_id, created_at)
                VALUES (:lineage_id, :user_id, CURRENT_TIMESTAMP)
                """
            ),
            parameters,
        )
        connection.execute(
            sa.text(
                """
                INSERT INTO recipe_versions (
                    id, lineage_id, parent_version_id, created_by_user_id,
                    version_number, title, description, servings, created_at
                ) VALUES (
                    :version_id, :lineage_id, NULL, :user_id,
                    1, 'Existing public recipe', NULL, 2.00, CURRENT_TIMESTAMP
                )
                """
            ),
            parameters,
        )

        command.upgrade(alembic_config, "head")
        publication = connection.execute(
            sa.text(
                """
                SELECT state, actor_user_id, source_draft_id, action_id, published_at,
                       author_withdrawn_at, moderation_hidden_at,
                       state_changed_at, state_changed_by_user_id
                FROM recipe_version_publications
                WHERE recipe_version_id = :version_id
                """
            ),
            {"version_id": version_id},
        ).one()
        assert publication[0:4] == ("published", user_id, None, None)
        assert publication.published_at is not None
        assert publication.author_withdrawn_at is None
        assert publication.moderation_hidden_at is None
        assert publication.state_changed_at == publication.published_at
        assert publication.state_changed_by_user_id == user_id
        initial_event = connection.execute(
            sa.text(
                """
                SELECT previous_state, state, actor_user_id,
                       author_withdrawn_at, moderation_hidden_at, occurred_at
                FROM recipe_version_visibility_events
                WHERE recipe_version_id = :version_id
                """
            ),
            {"version_id": version_id},
        ).one()
        assert initial_event[0:5] == (None, "published", user_id, None, None)
        assert initial_event.occurred_at == publication.state_changed_at

        connection.execute(
            sa.text(
                """
                UPDATE recipe_version_publications
                SET state = 'author_withdrawn',
                    author_withdrawn_at = state_changed_at + INTERVAL '1 second',
                    state_changed_at = state_changed_at + INTERVAL '1 second',
                    state_changed_by_user_id = :user_id
                WHERE recipe_version_id = :version_id
                """
            ),
            {"user_id": user_id, "version_id": version_id},
        )
        visibility_events = connection.execute(
            sa.text(
                """
                SELECT previous_state, state, actor_user_id, author_withdrawn_at,
                       moderation_hidden_at, occurred_at
                FROM recipe_version_visibility_events
                WHERE recipe_version_id = :version_id
                ORDER BY id
                """
            ),
            {"version_id": version_id},
        ).all()
        assert [(event.previous_state, event.state) for event in visibility_events] == [
            (None, "published"),
            ("published", "author_withdrawn"),
        ]
        assert visibility_events[-1].actor_user_id == user_id
        assert visibility_events[-1].author_withdrawn_at is not None
        assert visibility_events[-1].moderation_hidden_at is None
        assert visibility_events[-1].occurred_at == visibility_events[-1].author_withdrawn_at

        with pytest.raises(IntegrityError, match="publication evidence is append-only"):
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "UPDATE recipe_version_publications SET actor_user_id = :user_id "
                        "WHERE recipe_version_id = :version_id"
                    ),
                    {"user_id": uuid4(), "version_id": version_id},
                )
        with pytest.raises(IntegrityError, match="visibility audit events are append-only"):
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "UPDATE recipe_version_visibility_events SET state = 'published' "
                        "WHERE recipe_version_id = :version_id"
                    ),
                    {"version_id": version_id},
                )

        with pytest.raises(IntegrityError, match="published recipe snapshots are immutable"):
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "UPDATE recipe_versions SET title = 'Rewritten' WHERE id = :version_id"
                    ),
                    {"version_id": version_id},
                )
        with pytest.raises(IntegrityError, match="published recipe lineages are immutable"):
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "UPDATE recipe_lineages SET created_by_user_id = :user_id "
                        "WHERE id = :lineage_id"
                    ),
                    {"user_id": user_id, "lineage_id": lineage_id},
                )
        with pytest.raises(IntegrityError, match="publication evidence is append-only"):
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "DELETE FROM recipe_version_publications "
                        "WHERE recipe_version_id = :version_id"
                    ),
                    {"version_id": version_id},
                )

        # New algorithm-version evidence is intentionally append-only after publication.
        connection.execute(
            sa.text(
                """
                INSERT INTO recipe_structural_fingerprints (
                    recipe_version_id, algorithm_version, digest, canonical_payload
                ) VALUES (
                    :version_id, 'future-recipe-structure-v2', :digest, :payload
                )
                """
            ),
            {"version_id": version_id, "digest": "a" * 64, "payload": '{"version":2}'},
        )
        with pytest.raises(IntegrityError, match="published recipe snapshots are immutable"):
            with connection.begin_nested():
                connection.execute(
                    sa.text(
                        "UPDATE recipe_structural_fingerprints SET digest = :digest "
                        "WHERE recipe_version_id = :version_id "
                        "AND algorithm_version = 'future-recipe-structure-v2'"
                    ),
                    {"version_id": version_id, "digest": "b" * 64},
                )


def test_ingredient_migration_backfills_legacy_recipe_rows(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    user_id = uuid4()
    lineage_id = uuid4()
    version_id = uuid4()
    authored_names = [" Brown Sugar ", "brown sugar", "Eggs"]

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260820_0002")

        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=connection)
        lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
        versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
        recipe_ingredients = sa.Table(
            "recipe_version_ingredients",
            metadata,
            autoload_with=connection,
        )

        connection.execute(
            users.insert().values(
                id=user_id,
                email="legacy-migration@example.com",
                display_name="Legacy Migration",
            )
        )
        connection.execute(lineages.insert().values(id=lineage_id, created_by_user_id=user_id))
        connection.execute(
            versions.insert().values(
                id=version_id,
                lineage_id=lineage_id,
                parent_version_id=None,
                created_by_user_id=user_id,
                version_number=1,
                title="Legacy Recipe",
                description=None,
                servings=Decimal("4.00"),
            )
        )
        connection.execute(
            recipe_ingredients.insert(),
            [
                {
                    "id": uuid4(),
                    "recipe_version_id": version_id,
                    "name": name,
                    "quantity": None,
                    "unit": None,
                    "preparation_notes": None,
                    "display_order": display_order,
                }
                for display_order, name in enumerate(authored_names)
            ],
        )

        command.upgrade(alembic_config, "head")

        migrated_rows = connection.execute(
            sa.text(
                """
                SELECT name, ingredient_id
                FROM recipe_version_ingredients
                ORDER BY display_order
                """
            )
        ).all()
        canonical_names = connection.execute(
            sa.text("SELECT lower(btrim(canonical_name)) FROM ingredients ORDER BY 1")
        ).scalars()

        assert [row.name for row in migrated_rows] == authored_names
        assert all(isinstance(row.ingredient_id, UUID) for row in migrated_rows)
        assert migrated_rows[0].ingredient_id == migrated_rows[1].ingredient_id
        assert migrated_rows[0].ingredient_id != migrated_rows[2].ingredient_id
        assert list(canonical_names) == ["brown sugar", "eggs"]

        command.downgrade(alembic_config, "20260820_0002")

        downgraded_inspector = inspect(connection)
        assert INGREDIENT_TABLES.isdisjoint(downgraded_inspector.get_table_names())
        assert "ingredient_id" not in {
            column["name"]
            for column in downgraded_inspector.get_columns("recipe_version_ingredients")
        }
        remaining_names = connection.execute(
            sa.text(
                """
                SELECT name
                FROM recipe_version_ingredients
                ORDER BY display_order
                """
            )
        ).scalars()
        assert list(remaining_names) == authored_names

        command.upgrade(alembic_config, "head")
        reupgraded_rows = connection.execute(
            sa.text("SELECT ingredient_id FROM recipe_version_ingredients")
        ).scalars()
        assert all(isinstance(ingredient_id, UUID) for ingredient_id in reupgraded_rows)


def test_measurement_migration_audits_and_backfills_known_legacy_rows_losslessly(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260820_0002")
        version_id, row_ids = _insert_legacy_recipe_rows(
            connection,
            [
                ("Brown Sugar", Decimal("2.5000"), " grams "),
                ("Eggs", None, None),
            ],
        )
        command.upgrade(alembic_config, "20260824_0008")

        report = build_legacy_measurement_audit(connection)
        assert report["schema_state"] == "legacy"
        assert report["summary"] == {
            "exact_rows": 1,
            "reason_counts": {},
            "total_rows": 2,
            "unresolved_rows": 0,
            "unspecified_rows": 1,
        }
        assert report["unit_mappings"] == [
            {
                "measurement_unit_id": str(measurement_uuid("unit", "g")),
                "rows": 1,
                "unit_key": "g",
            }
        ]

        command.upgrade(alembic_config, "head")
        migrated = (
            connection.execute(
                sa.text(
                    """
                SELECT id, measure_mode, quantity_min, quantity_max,
                       measurement_unit_id, unit_display, package_size_id
                FROM recipe_version_ingredients
                WHERE recipe_version_id = :version_id
                ORDER BY display_order
                """
                ),
                {"version_id": version_id},
            )
            .mappings()
            .all()
        )
        assert migrated[0] == {
            "id": row_ids[0],
            "measure_mode": "exact",
            "quantity_min": Decimal("2.5000"),
            "quantity_max": None,
            "measurement_unit_id": measurement_uuid("unit", "g"),
            "unit_display": " grams ",
            "package_size_id": None,
        }
        assert migrated[1]["measure_mode"] == "unspecified"
        assert migrated[1]["quantity_min"] is None
        assert migrated[1]["measurement_unit_id"] is None
        assert migrated[1]["unit_display"] is None
        assert build_legacy_measurement_audit(connection)["schema_state"] == "structured"

        command.downgrade(alembic_config, "20260824_0008")
        legacy = (
            connection.execute(
                sa.text(
                    """
                SELECT id, quantity, unit
                FROM recipe_version_ingredients
                WHERE recipe_version_id = :version_id
                ORDER BY display_order
                """
                ),
                {"version_id": version_id},
            )
            .mappings()
            .all()
        )
        assert legacy == [
            {"id": row_ids[0], "quantity": Decimal("2.5000"), "unit": " grams "},
            {"id": row_ids[1], "quantity": None, "unit": None},
        ]


def test_measurement_migration_refuses_unresolved_rows_before_schema_changes(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260820_0002")
        _, row_ids = _insert_legacy_recipe_rows(
            connection,
            [("Brown Sugar", Decimal("1.0000"), "mystery scoop")],
        )
        command.upgrade(alembic_config, "20260824_0008")

        report = build_legacy_measurement_audit(connection)
        assert report["summary"]["unresolved_rows"] == 1
        assert report["summary"]["reason_counts"] == {"unknown_unit_label": 1}
        assert report["unresolved"][0]["row_id"] == str(row_ids[0])
        assert "email" not in str(report).casefold()

        with pytest.raises(RuntimeError, match="migration refused unresolved legacy rows"):
            command.upgrade(alembic_config, "head")

        assert MigrationContext.configure(connection).get_current_revision() == "20260824_0008"
        inspector = inspect(connection)
        assert "measurement_units" not in inspector.get_table_names()
        columns = {column["name"] for column in inspector.get_columns("recipe_version_ingredients")}
        assert {"quantity", "unit"} <= columns
        assert "quantity_min" not in columns
        assert "measure_mode" not in columns


def test_measurement_migration_refuses_non_ingredient_unit_dimensions(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260820_0002")
        _, row_ids = _insert_legacy_recipe_rows(
            connection,
            [("Brown Sugar", Decimal("1.0000"), "minute")],
        )
        command.upgrade(alembic_config, "20260824_0008")

        report = build_legacy_measurement_audit(connection)
        assert report["summary"]["unresolved_rows"] == 1
        assert report["summary"]["reason_counts"] == {"incompatible_unit_dimension": 1}
        assert report["unresolved"][0]["row_id"] == str(row_ids[0])

        with pytest.raises(RuntimeError, match="migration refused unresolved legacy rows"):
            command.upgrade(alembic_config, "head")

        assert MigrationContext.configure(connection).get_current_revision() == "20260824_0008"


def test_measurement_downgrade_refuses_range_rows_losslessly(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    user_id = uuid4()
    lineage_id = uuid4()
    version_id = uuid4()
    ingredient_id = uuid4()
    row_id = uuid4()
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        connection.execute(
            sa.text(
                """
                INSERT INTO users (id, email, display_name)
                VALUES (:user_id, :email, 'Range Migration')
                """
            ),
            {"user_id": user_id, "email": f"range-{user_id}@example.com"},
        )
        connection.execute(
            sa.text(
                "INSERT INTO recipe_lineages (id, created_by_user_id) "
                "VALUES (:lineage_id, :user_id)"
            ),
            {"lineage_id": lineage_id, "user_id": user_id},
        )
        connection.execute(
            sa.text(
                """
                INSERT INTO recipe_versions (
                    id, lineage_id, created_by_user_id, version_number, title, servings
                ) VALUES (
                    :version_id, :lineage_id, :user_id, 1, 'Range Recipe', 4.00
                )
                """
            ),
            {
                "version_id": version_id,
                "lineage_id": lineage_id,
                "user_id": user_id,
            },
        )
        connection.execute(
            sa.text(
                "INSERT INTO ingredients (id, canonical_name) VALUES (:id, 'Range ingredient')"
            ),
            {"id": ingredient_id},
        )
        connection.execute(
            sa.text(
                """
                INSERT INTO recipe_version_ingredients (
                    id, recipe_version_id, ingredient_id, name, measure_mode,
                    quantity_min, quantity_max, measurement_unit_id, unit_display,
                    package_size_id, display_order
                ) VALUES (
                    :row_id, :version_id, :ingredient_id, 'Range ingredient', 'range',
                    1.0000, 2.0000, :unit_id, 'g', NULL, 0
                )
                """
            ),
            {
                "row_id": row_id,
                "version_id": version_id,
                "ingredient_id": ingredient_id,
                "unit_id": measurement_uuid("unit", "g"),
            },
        )

        with pytest.raises(RuntimeError, match="cannot be represented losslessly"):
            command.downgrade(alembic_config, "20260824_0008")

        assert MigrationContext.configure(connection).get_current_revision() == "20260824_0009"
        stored = connection.execute(
            sa.text(
                "SELECT measure_mode, quantity_min, quantity_max "
                "FROM recipe_version_ingredients WHERE id = :row_id"
            ),
            {"row_id": row_id},
        ).one()
        assert stored == ("range", Decimal("1.0000"), Decimal("2.0000"))


def test_measurement_downgrade_refuses_unit_text_that_changes_identity(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260820_0002")
        _, row_ids = _insert_legacy_recipe_rows(
            connection,
            [("Brown Sugar", Decimal("1.0000"), "g")],
        )
        command.upgrade(alembic_config, "20260825_0013")
        connection.execute(
            sa.text(
                """
                UPDATE recipe_version_ingredients
                SET unit_display = 'kg'
                WHERE id = :row_id
                """
            ),
            {"row_id": row_ids[0]},
        )

        with pytest.raises(RuntimeError, match="does not preserve the curated unit identity"):
            command.downgrade(alembic_config, "20260824_0008")

        assert MigrationContext.configure(connection).get_current_revision() == "20260824_0009"
        stored = connection.execute(
            sa.text(
                """
                SELECT measurement_unit_id, unit_display
                FROM recipe_version_ingredients
                WHERE id = :row_id
                """
            ),
            {"row_id": row_ids[0]},
        ).one()
        assert stored == (measurement_uuid("unit", "g"), "kg")


def test_measurement_downgrade_refuses_non_seed_catalog_metadata(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    custom_alias_id = uuid4()
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        connection.execute(
            sa.text(
                """
                INSERT INTO measurement_unit_aliases (id, measurement_unit_id, alias)
                VALUES (:id, :unit_id, 'reviewed gram downgrade test')
                """
            ),
            {
                "id": custom_alias_id,
                "unit_id": measurement_uuid("unit", "g"),
            },
        )

        with pytest.raises(RuntimeError, match="refused reviewed catalog data"):
            command.downgrade(alembic_config, "20260824_0008")

        assert MigrationContext.configure(connection).get_current_revision() == "20260824_0009"
        assert (
            connection.scalar(
                sa.text("SELECT count(*) FROM measurement_unit_aliases WHERE id = :id"),
                {"id": custom_alias_id},
            )
            == 1
        )


def _insert_seed_action_migration_fixture(
    connection: Connection,
) -> tuple[UUID, UUID]:
    catalog = load_frozen_action_backfill_catalog()
    recipe = next(item for item in catalog.recipes if item.key == "blueberry-oat-muffins-v1")
    instruction = next(item for item in recipe.instructions if item.key == "prepare")
    dataset_id = catalog.dataset_id
    user_id = uuid4()
    lineage_id = frozen_seed_uuid(dataset_id, "recipe-lineage", recipe.key)
    version_id = frozen_seed_uuid(dataset_id, "recipe-version", recipe.key)
    instruction_id = frozen_seed_uuid(
        dataset_id,
        "recipe-instruction",
        f"{recipe.key}:{instruction.key}",
    )
    non_seed_instruction_id = uuid4()
    metadata = sa.MetaData()
    users = sa.Table("users", metadata, autoload_with=connection)
    lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
    versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
    instructions = sa.Table(
        "recipe_version_instructions",
        metadata,
        autoload_with=connection,
    )
    connection.execute(
        users.insert().values(
            id=user_id,
            email=f"action-migration-{user_id}@example.com",
            display_name="Action migration test",
        )
    )
    connection.execute(lineages.insert().values(id=lineage_id, created_by_user_id=user_id))
    connection.execute(
        versions.insert().values(
            id=version_id,
            lineage_id=lineage_id,
            parent_version_id=None,
            created_by_user_id=user_id,
            version_number=1,
            title="Action migration fixture",
            description=None,
            servings=Decimal("1.00"),
        )
    )
    connection.execute(
        instructions.insert(),
        [
            {
                "id": instruction_id,
                "recipe_version_id": version_id,
                "instruction": instruction.text,
                "display_order": 0,
            },
            {
                "id": non_seed_instruction_id,
                "recipe_version_id": version_id,
                "instruction": instruction.text,
                "display_order": 1,
            },
        ],
    )
    return instruction_id, non_seed_instruction_id


def test_action_migration_uses_only_explicit_seed_mappings(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260824_0009")
        instruction_id, non_seed_instruction_id = _insert_seed_action_migration_fixture(connection)
        command.upgrade(alembic_config, "head")

        mapped = connection.execute(
            sa.text(
                """
                SELECT id, action_type_id, display_order
                FROM recipe_instruction_actions
                WHERE recipe_instruction_id = :instruction_id
                ORDER BY display_order
                """
            ),
            {"instruction_id": instruction_id},
        ).all()
        inferred = connection.scalar(
            sa.text(
                """
                SELECT count(*)
                FROM recipe_instruction_actions
                WHERE recipe_instruction_id = :instruction_id
                """
            ),
            {"instruction_id": non_seed_instruction_id},
        )
        temperature = connection.execute(
            sa.text(
                """
                SELECT semantic, measure_mode, quantity_min, measurement_unit_id
                FROM recipe_instruction_action_measures
                WHERE recipe_instruction_action_id = :action_id
                """
            ),
            {"action_id": mapped[0].id},
        ).one()

        assert len(mapped) == 2
        assert mapped[0].action_type_id == frozen_action_uuid("action-type", "preheat")
        assert mapped[1].action_type_id == frozen_action_uuid("action-type", "line")
        assert inferred == 0
        assert temperature == (
            "temperature",
            "exact",
            Decimal("190.000000"),
            frozen_measurement_uuid("unit", "celsius"),
        )

        command.downgrade(alembic_config, "20260824_0009")
        assert MigrationContext.configure(connection).get_current_revision() == "20260824_0009"


def test_action_downgrade_refuses_user_authored_structure(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260824_0009")
        instruction_id, _non_seed_instruction_id = _insert_seed_action_migration_fixture(connection)
        command.upgrade(alembic_config, "20260825_0013")
        connection.execute(
            sa.text(
                """
                INSERT INTO recipe_instruction_actions
                    (id, recipe_version_id, recipe_instruction_id,
                     action_type_id, display_order)
                SELECT :id, recipe_version_id, id, :action_type_id, 2
                FROM recipe_version_instructions
                WHERE id = :instruction_id
                """
            ),
            {
                "id": uuid4(),
                "action_type_id": action_uuid("action-type", "serve"),
                "instruction_id": instruction_id,
            },
        )

        with pytest.raises(RuntimeError, match="downgrade refused"):
            command.downgrade(alembic_config, "20260824_0009")

        assert MigrationContext.configure(connection).get_current_revision() == ("20260824_0010")


def test_secure_account_migration_classifies_seed_users_without_rekeying(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    catalog_author_id = UUID("16746db2-8776-5937-856c-252b72442671")
    demo_cook_id = UUID("1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9")
    member_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260821_0004")

        legacy_users = sa.Table("users", sa.MetaData(), autoload_with=connection)
        connection.execute(
            legacy_users.insert(),
            [
                {
                    "id": catalog_author_id,
                    "email": "demo-catalog@recipe-lab.invalid",
                    "display_name": "Recipe Lab Demo Catalog",
                },
                {
                    "id": demo_cook_id,
                    "email": "demo-cook@recipe-lab.invalid",
                    "display_name": "Demo Cook",
                },
                {
                    "id": member_id,
                    "email": "member@example.com",
                    "display_name": "Existing Member",
                },
            ],
        )

        command.upgrade(alembic_config, "head")

        users = sa.Table("users", sa.MetaData(), autoload_with=connection)
        rows = {
            row.id: row
            for row in connection.execute(
                sa.select(
                    users.c.id,
                    users.c.email,
                    users.c.account_kind,
                    users.c.status,
                    users.c.created_at,
                    users.c.updated_at,
                )
            )
        }
        assert rows[catalog_author_id].account_kind == "system"
        assert rows[demo_cook_id].account_kind == "demo"
        assert rows[member_id].account_kind == "member"
        assert all(row.status == "active" for row in rows.values())
        assert all(row.updated_at == row.created_at for row in rows.values())

        connection.execute(
            users.insert().values(
                id=uuid4(),
                email=rows[member_id].email,
                display_name="Same Email, Different Identity",
            )
        )


def test_public_recipe_migrations_preserve_legacy_demo_cook_attribution(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    lineage_id = uuid4()
    recipe_version_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260825_0013")

        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=connection)
        lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
        versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
        connection.execute(
            users.insert().values(
                id=DEMO_USER_ID,
                email=DEMO_USER_EMAIL,
                display_name=DEMO_USER_DISPLAY_NAME,
                handle=None,
                account_kind="demo",
                status="active",
            )
        )
        connection.execute(lineages.insert().values(id=lineage_id, created_by_user_id=DEMO_USER_ID))
        connection.execute(
            versions.insert().values(
                id=recipe_version_id,
                lineage_id=lineage_id,
                parent_version_id=None,
                created_by_user_id=DEMO_USER_ID,
                version_number=1,
                title="Legacy Demo Cook recipe",
                description="A public recipe retained from the shared demo identity.",
                servings=Decimal("4.00"),
            )
        )

        command.upgrade(alembic_config, "head")

        migrated_author = connection.execute(
            sa.text("SELECT id, handle FROM users WHERE id = CAST(:id AS uuid)"),
            {"id": str(DEMO_USER_ID)},
        ).one()
        assert migrated_author.id == DEMO_USER_ID
        assert migrated_author.handle is None
        assert (
            connection.scalar(
                sa.text(
                    "SELECT state FROM recipe_version_publications "
                    "WHERE recipe_version_id = CAST(:recipe_version_id AS uuid)"
                ),
                {"recipe_version_id": str(recipe_version_id)},
            )
            == "published"
        )
        assert (
            connection.scalar(
                sa.text(
                    "SELECT created_by_user_id FROM recipe_versions "
                    "WHERE id = CAST(:recipe_version_id AS uuid)"
                ),
                {"recipe_version_id": str(recipe_version_id)},
            )
            == DEMO_USER_ID
        )

        with Session(bind=connection, join_transaction_mode="create_savepoint") as session:
            public_page = browse_recipe_versions(
                session,
                search=None,
                lineage_id=None,
                ingredient_name=None,
                is_variant=None,
                offset=0,
                limit=10,
            )
            assert [recipe.id for recipe in public_page.items] == [recipe_version_id]
            summary = recipe_summary_response(public_page.items[0]).model_dump(mode="json")

        assert summary["author"] == {
            "id": str(DEMO_USER_ID),
            "handle": None,
            "display_name": DEMO_USER_DISPLAY_NAME,
        }


def test_activity_migration_preserves_legacy_actor_and_scopes_action_keys(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    legacy_demo_id = UUID("1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9")
    member_a_id = uuid4()
    member_b_id = uuid4()
    lineage_id = uuid4()
    recipe_version_id = uuid4()
    legacy_event_id = uuid4()
    shared_action_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260823_0005")

        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=connection)
        lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
        versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
        legacy_events = sa.Table("preference_events", metadata, autoload_with=connection)
        connection.execute(
            users.insert(),
            [
                {
                    "id": legacy_demo_id,
                    "email": "demo-cook@recipe-lab.invalid",
                    "display_name": "Legacy Demo Cook",
                    "account_kind": "demo",
                    "status": "active",
                },
                {
                    "id": member_a_id,
                    "email": "migration-a@example.test",
                    "display_name": "Migration Member A",
                    "handle": "migration_member_a",
                    "account_kind": "member",
                    "status": "active",
                },
                {
                    "id": member_b_id,
                    "email": "migration-b@example.test",
                    "display_name": "Migration Member B",
                    "handle": "migration_member_b",
                    "account_kind": "member",
                    "status": "active",
                },
            ],
        )
        connection.execute(
            lineages.insert().values(id=lineage_id, created_by_user_id=legacy_demo_id)
        )
        connection.execute(
            versions.insert().values(
                id=recipe_version_id,
                lineage_id=lineage_id,
                parent_version_id=None,
                created_by_user_id=legacy_demo_id,
                version_number=1,
                title="Legacy activity recipe",
                description=None,
                servings=Decimal("4.00"),
            )
        )
        connection.execute(
            legacy_events.insert().values(
                id=legacy_event_id,
                user_id=legacy_demo_id,
                recipe_version_id=recipe_version_id,
                event_type="view",
            )
        )

        command.upgrade(alembic_config, "20260823_0006")
        migrated_events = sa.Table(
            "preference_events",
            sa.MetaData(),
            autoload_with=connection,
        )
        legacy_row = connection.execute(
            sa.select(
                migrated_events.c.id,
                migrated_events.c.action_id,
                migrated_events.c.user_id,
                migrated_events.c.event_type,
            ).where(migrated_events.c.id == legacy_event_id)
        ).one()
        assert legacy_row.id == legacy_event_id
        assert legacy_row.action_id == legacy_event_id
        assert legacy_row.user_id == legacy_demo_id
        assert legacy_row.event_type == "view"
        assert (
            connection.scalar(sa.select(users.c.account_kind).where(users.c.id == legacy_demo_id))
            == "demo"
        )

        connection.execute(
            migrated_events.insert(),
            [
                {
                    "id": uuid4(),
                    "action_id": shared_action_id,
                    "user_id": member_a_id,
                    "recipe_version_id": recipe_version_id,
                    "event_type": "view",
                    "saved_value": None,
                },
                {
                    "id": uuid4(),
                    "action_id": shared_action_id,
                    "user_id": member_b_id,
                    "recipe_version_id": recipe_version_id,
                    "event_type": "view",
                    "saved_value": None,
                },
                {
                    "id": uuid4(),
                    "action_id": shared_action_id,
                    "user_id": member_a_id,
                    "recipe_version_id": recipe_version_id,
                    "event_type": "save",
                    "saved_value": True,
                },
            ],
        )
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    migrated_events.insert().values(
                        id=uuid4(),
                        action_id=shared_action_id,
                        user_id=member_a_id,
                        recipe_version_id=recipe_version_id,
                        event_type="view",
                    )
                )

        scoped_rows = connection.scalar(
            sa.select(sa.func.count())
            .select_from(migrated_events)
            .where(migrated_events.c.action_id == shared_action_id)
        )
        assert scoped_rows == 3


def test_community_moderation_migration_enforces_attestations_and_append_only_audit(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    author_id = uuid4()
    reporter_id = uuid4()
    moderator_id = uuid4()
    lineage_id = uuid4()
    recipe_version_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=connection)
        lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
        versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
        publications = sa.Table("recipe_version_publications", metadata, autoload_with=connection)
        moderators = sa.Table("community_moderators", metadata, autoload_with=connection)
        cases = sa.Table("recipe_moderation_cases", metadata, autoload_with=connection)
        reports = sa.Table("recipe_reports", metadata, autoload_with=connection)
        audit_events = sa.Table(
            "recipe_moderation_audit_events", metadata, autoload_with=connection
        )
        connection.execute(
            users.insert(),
            [
                {
                    "id": user_id,
                    "email": f"{label}@migration.example.test",
                    "handle": f"migration_{label}",
                    "display_name": f"Migration {label.title()}",
                    "account_kind": "member",
                    "status": "active",
                }
                for user_id, label in (
                    (author_id, "author"),
                    (reporter_id, "reporter"),
                    (moderator_id, "moderator"),
                )
            ],
        )
        connection.execute(lineages.insert().values(id=lineage_id, created_by_user_id=author_id))
        connection.execute(
            versions.insert().values(
                id=recipe_version_id,
                lineage_id=lineage_id,
                parent_version_id=None,
                created_by_user_id=author_id,
                version_number=1,
                title="Migration moderation recipe",
                servings=Decimal("2.00"),
            )
        )
        connection.execute(
            publications.insert().values(
                recipe_version_id=recipe_version_id,
                actor_user_id=author_id,
                community_rules_version="community-rules-v1",
                publication_rights_confirmed_at=sa.func.now(),
            )
        )
        connection.execute(
            moderators.insert().values(
                user_id=moderator_id,
                granted_by_user_id=author_id,
            )
        )
        connection.execute(
            cases.insert().values(
                recipe_version_id=recipe_version_id,
                status="open",
                reporter_count=1,
                last_reported_at=sa.func.now(),
            )
        )
        connection.execute(
            reports.insert().values(
                id=uuid4(),
                recipe_version_id=recipe_version_id,
                reporter_user_id=reporter_id,
                reason="spam",
                details="Repeated promotional content.",
                action_id=uuid4(),
                request_fingerprint="a" * 64,
            )
        )
        audit_id = connection.scalar(
            audit_events.insert()
            .values(
                recipe_version_id=recipe_version_id,
                actor_user_id=moderator_id,
                action="hide",
                previous_status="open",
                status="open",
                visibility_state="moderation_hidden",
                private_note="Reviewed by the migration fixture.",
                action_id=uuid4(),
                request_fingerprint="b" * 64,
            )
            .returning(audit_events.c.id)
        )
        assert audit_id is not None
        receipt = connection.execute(
            sa.select(
                publications.c.community_rules_version,
                publications.c.publication_rights_confirmed_at,
            ).where(publications.c.recipe_version_id == recipe_version_id)
        ).one()
        assert receipt.community_rules_version == "community-rules-v1"
        assert receipt.publication_rights_confirmed_at is not None

        with pytest.raises(
            IntegrityError,
            match="recipe moderation audit events are append-only",
        ):
            with connection.begin_nested():
                connection.execute(
                    audit_events.update()
                    .where(audit_events.c.id == audit_id)
                    .values(private_note="Rewritten evidence")
                )


def test_community_moderation_downgrade_refuses_durable_attestation_evidence(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    author_id = uuid4()
    lineage_id = uuid4()
    recipe_version_id = uuid4()

    with empty_postgres_engine.connect() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "head")
        with connection.begin():
            metadata = sa.MetaData()
            users = sa.Table("users", metadata, autoload_with=connection)
            lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
            versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
            publications = sa.Table(
                "recipe_version_publications", metadata, autoload_with=connection
            )
            connection.execute(
                users.insert().values(
                    id=author_id,
                    email="downgrade-author@example.test",
                    handle="downgrade_author",
                    display_name="Downgrade Author",
                    account_kind="member",
                    status="active",
                )
            )
            connection.execute(
                lineages.insert().values(id=lineage_id, created_by_user_id=author_id)
            )
            connection.execute(
                versions.insert().values(
                    id=recipe_version_id,
                    lineage_id=lineage_id,
                    parent_version_id=None,
                    created_by_user_id=author_id,
                    version_number=1,
                    title="Durable attestation recipe",
                    servings=Decimal("1.00"),
                )
            )
            connection.execute(
                publications.insert().values(
                    recipe_version_id=recipe_version_id,
                    actor_user_id=author_id,
                    community_rules_version="community-rules-v1",
                    publication_rights_confirmed_at=sa.func.now(),
                )
            )

        with pytest.raises(ProgrammingError, match="cannot downgrade community moderation"):
            command.downgrade(alembic_config, "20260826_0017")


def test_public_profile_description_migration_is_nullable_bounded_and_scrubbed_on_delete(
    empty_postgres_engine: Engine,
    alembic_config: Config,
) -> None:
    member_id = uuid4()

    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260830_0025")
        legacy_metadata = sa.MetaData()
        legacy_users = sa.Table("users", legacy_metadata, autoload_with=connection)
        connection.execute(
            legacy_users.insert().values(
                id=member_id,
                email="profile-migration@example.test",
                handle="profile_migration",
                display_name="Profile Migration",
                account_kind="member",
                status="active",
            )
        )

        command.upgrade(alembic_config, "head")
        migrated_metadata = sa.MetaData()
        users = sa.Table("users", migrated_metadata, autoload_with=connection)
        assert users.c.profile_description.nullable is True
        profile_description_type = users.c.profile_description.type
        assert isinstance(profile_description_type, sa.String)
        assert profile_description_type.length == 500
        assert (
            connection.scalar(sa.select(users.c.profile_description).where(users.c.id == member_id))
            is None
        )

        connection.execute(
            users.update()
            .where(users.c.id == member_id)
            .values(profile_description="Weeknight recipes.")
        )
        with pytest.raises(IntegrityError, match="profile_description_valid"):
            with connection.begin_nested():
                connection.execute(
                    users.update().where(users.c.id == member_id).values(profile_description="   ")
                )
        with pytest.raises(IntegrityError, match="lifecycle_shape_valid"):
            with connection.begin_nested():
                connection.execute(
                    users.update()
                    .where(users.c.id == member_id)
                    .values(
                        status="deleted",
                        email=None,
                        handle=None,
                        display_name="Deleted cook",
                        deleted_at=sa.func.now(),
                    )
                )

        command.downgrade(alembic_config, "20260830_0025")
        downgraded_columns = {column["name"] for column in inspect(connection).get_columns("users")}
        assert "profile_description" not in downgraded_columns
