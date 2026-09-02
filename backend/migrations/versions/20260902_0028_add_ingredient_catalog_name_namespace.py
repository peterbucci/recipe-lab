"""add ingredient catalog name namespace

Revision ID: 20260902_0028
Revises: 20260902_0027
Create Date: 2026-09-02 20:00:00.000000

"""

import unicodedata
from collections.abc import Sequence
from hashlib import sha256
from uuid import UUID, uuid5

import sqlalchemy as sa
from alembic import op

revision: str = "20260902_0028"
down_revision: str | None = "20260902_0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NAME_ID_NAMESPACE = UUID("01ea902d-6925-43cc-868f-920c541b48cf")
_SOURCE_GUARD_FUNCTION = "enforce_ingredient_catalog_name_namespace"
_NAME_GUARD_FUNCTION = "enforce_ingredient_catalog_name_source"
_INGREDIENT_TRIGGER = "ingredient_catalog_name_namespace_required"
_ALIAS_TRIGGER = "ingredient_alias_catalog_name_namespace_required"
_NAME_TRIGGER = "ingredient_catalog_name_source_matches"


def _normalize_catalog_name(value: str) -> str:
    compatibility_normalized = unicodedata.normalize("NFKC", value)
    return " ".join(compatibility_normalized.split()).casefold()


def _name_id(name_kind: str, source_id: UUID) -> UUID:
    return uuid5(_NAME_ID_NAMESPACE, f"{name_kind}:{source_id}")


def _backfill_catalog_names() -> None:
    connection = op.get_bind()
    sources: list[tuple[str, UUID, str, object]] = []
    sources.extend(
        (
            "canonical",
            row.id,
            row.canonical_name,
            row.created_at,
        )
        for row in connection.execute(
            sa.text("SELECT id, canonical_name, created_at FROM ingredients ORDER BY id")
        ).mappings()
    )
    sources.extend(
        (
            "alias",
            row.id,
            row.alias,
            row.created_at,
        )
        for row in connection.execute(
            sa.text("SELECT id, alias, created_at FROM ingredient_aliases ORDER BY id")
        ).mappings()
    )

    rows: list[dict[str, object]] = []
    digests: dict[str, tuple[str, str, UUID]] = {}
    for name_kind, source_id, display_name, created_at in sources:
        normalized_name = _normalize_catalog_name(display_name)
        digest = sha256(normalized_name.encode("utf-8")).hexdigest()
        existing = digests.get(digest)
        if existing is not None:
            existing_normalized, existing_kind, existing_source_id = existing
            collision = (
                "normalized catalog name collision"
                if existing_normalized == normalized_name
                else "catalog name digest collision"
            )
            raise RuntimeError(
                f"Cannot backfill ingredient catalog namespace: {collision} between "
                f"{existing_kind} {existing_source_id} and {name_kind} {source_id}."
            )
        digests[digest] = (normalized_name, name_kind, source_id)
        rows.append(
            {
                "id": _name_id(name_kind, source_id),
                "name_kind": name_kind,
                "display_name": display_name,
                "normalized_name": normalized_name,
                "normalized_name_digest": digest,
                "canonical_ingredient_id": source_id if name_kind == "canonical" else None,
                "ingredient_alias_id": source_id if name_kind == "alias" else None,
                "created_at": created_at,
            }
        )

    if rows:
        catalog_names = sa.table(
            "ingredient_catalog_names",
            sa.column("id", sa.Uuid()),
            sa.column("name_kind", sa.String()),
            sa.column("display_name", sa.String()),
            sa.column("normalized_name", sa.Text()),
            sa.column("normalized_name_digest", sa.String()),
            sa.column("canonical_ingredient_id", sa.Uuid()),
            sa.column("ingredient_alias_id", sa.Uuid()),
            sa.column("created_at", sa.DateTime(timezone=True)),
        )
        op.bulk_insert(catalog_names, rows)


def _create_namespace_guards() -> None:
    op.execute(
        sa.text(
            f"""
            CREATE FUNCTION {_SOURCE_GUARD_FUNCTION}()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF TG_TABLE_NAME = 'ingredients' THEN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM ingredient_catalog_names AS catalog_name
                        WHERE catalog_name.name_kind = 'canonical'
                          AND catalog_name.canonical_ingredient_id = NEW.id
                          AND catalog_name.ingredient_alias_id IS NULL
                          AND catalog_name.display_name = NEW.canonical_name
                    ) THEN
                        RAISE EXCEPTION
                            'ingredient canonical name is missing its normalized namespace row'
                            USING ERRCODE = '23514',
                                  CONSTRAINT = '{_INGREDIENT_TRIGGER}';
                    END IF;
                ELSIF TG_TABLE_NAME = 'ingredient_aliases' THEN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM ingredient_catalog_names AS catalog_name
                        WHERE catalog_name.name_kind = 'alias'
                          AND catalog_name.canonical_ingredient_id IS NULL
                          AND catalog_name.ingredient_alias_id = NEW.id
                          AND catalog_name.display_name = NEW.alias
                    ) THEN
                        RAISE EXCEPTION
                            'ingredient alias is missing its normalized namespace row'
                            USING ERRCODE = '23514',
                                  CONSTRAINT = '{_ALIAS_TRIGGER}';
                    END IF;
                END IF;
                RETURN NEW;
            END;
            $$
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            CREATE FUNCTION {_NAME_GUARD_FUNCTION}()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                IF TG_OP = 'DELETE' THEN
                    IF OLD.name_kind = 'canonical'
                       AND EXISTS (
                            SELECT 1
                            FROM ingredients AS ingredient
                            WHERE ingredient.id = OLD.canonical_ingredient_id
                       )
                       AND NOT EXISTS (
                            SELECT 1
                            FROM ingredient_catalog_names AS catalog_name
                            WHERE catalog_name.name_kind = 'canonical'
                              AND catalog_name.canonical_ingredient_id = OLD.canonical_ingredient_id
                              AND catalog_name.ingredient_alias_id IS NULL
                       ) THEN
                        RAISE EXCEPTION
                            'ingredient canonical name is missing its normalized namespace row'
                            USING ERRCODE = '23514',
                                  CONSTRAINT = '{_INGREDIENT_TRIGGER}';
                    ELSIF OLD.name_kind = 'alias'
                          AND EXISTS (
                            SELECT 1
                            FROM ingredient_aliases AS ingredient_alias
                            WHERE ingredient_alias.id = OLD.ingredient_alias_id
                          )
                          AND NOT EXISTS (
                            SELECT 1
                            FROM ingredient_catalog_names AS catalog_name
                            WHERE catalog_name.name_kind = 'alias'
                              AND catalog_name.canonical_ingredient_id IS NULL
                              AND catalog_name.ingredient_alias_id = OLD.ingredient_alias_id
                          ) THEN
                        RAISE EXCEPTION
                            'ingredient alias is missing its normalized namespace row'
                            USING ERRCODE = '23514',
                                  CONSTRAINT = '{_ALIAS_TRIGGER}';
                    END IF;
                    RETURN OLD;
                END IF;

                IF NEW.name_kind = 'canonical' THEN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM ingredients AS ingredient
                        WHERE ingredient.id = NEW.canonical_ingredient_id
                          AND ingredient.canonical_name = NEW.display_name
                    ) THEN
                        RAISE EXCEPTION
                            'canonical namespace row does not match its ingredient'
                            USING ERRCODE = '23514',
                                  CONSTRAINT = '{_NAME_TRIGGER}';
                    END IF;
                ELSIF NEW.name_kind = 'alias' THEN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM ingredient_aliases AS ingredient_alias
                        WHERE ingredient_alias.id = NEW.ingredient_alias_id
                          AND ingredient_alias.alias = NEW.display_name
                    ) THEN
                        RAISE EXCEPTION
                            'alias namespace row does not match its ingredient alias'
                            USING ERRCODE = '23514',
                                  CONSTRAINT = '{_NAME_TRIGGER}';
                    END IF;
                END IF;
                RETURN NEW;
            END;
            $$
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            CREATE CONSTRAINT TRIGGER {_INGREDIENT_TRIGGER}
            AFTER INSERT OR UPDATE ON ingredients
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW
            EXECUTE FUNCTION {_SOURCE_GUARD_FUNCTION}()
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            CREATE CONSTRAINT TRIGGER {_ALIAS_TRIGGER}
            AFTER INSERT OR UPDATE ON ingredient_aliases
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW
            EXECUTE FUNCTION {_SOURCE_GUARD_FUNCTION}()
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            CREATE CONSTRAINT TRIGGER {_NAME_TRIGGER}
            AFTER INSERT OR UPDATE OR DELETE ON ingredient_catalog_names
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW
            EXECUTE FUNCTION {_NAME_GUARD_FUNCTION}()
            """
        )
    )


def upgrade() -> None:
    op.create_table(
        "ingredient_catalog_names",
        sa.Column("name_kind", sa.String(length=16), nullable=False),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("normalized_name", sa.Text(), nullable=False),
        sa.Column("normalized_name_digest", sa.String(length=64), nullable=False),
        sa.Column("canonical_ingredient_id", sa.Uuid(), nullable=True),
        sa.Column("ingredient_alias_id", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "name_kind IN ('canonical', 'alias')",
            name=op.f("ck_ingredient_catalog_names_name_kind_supported"),
        ),
        sa.CheckConstraint(
            "btrim(display_name) <> ''",
            name=op.f("ck_ingredient_catalog_names_display_name_not_blank"),
        ),
        sa.CheckConstraint(
            "btrim(normalized_name) <> ''",
            name=op.f("ck_ingredient_catalog_names_normalized_name_not_blank"),
        ),
        sa.CheckConstraint(
            "normalized_name_digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_ingredient_catalog_names_normalized_name_digest_sha256"),
        ),
        sa.CheckConstraint(
            "normalized_name_digest = encode(sha256(convert_to(normalized_name, 'UTF8')), 'hex')",
            name=op.f("ck_ingredient_catalog_names_normalized_name_digest_matches"),
        ),
        sa.CheckConstraint(
            "(name_kind = 'canonical' AND canonical_ingredient_id IS NOT NULL "
            "AND ingredient_alias_id IS NULL) OR "
            "(name_kind = 'alias' AND canonical_ingredient_id IS NULL "
            "AND ingredient_alias_id IS NOT NULL)",
            name=op.f("ck_ingredient_catalog_names_source_shape_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["canonical_ingredient_id"],
            ["ingredients.id"],
            name=op.f("fk_ingredient_catalog_names_canonical_ingredient_id_ingredients"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["ingredient_alias_id"],
            ["ingredient_aliases.id"],
            name=op.f("fk_ingredient_catalog_names_ingredient_alias_id_ingredient_aliases"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ingredient_catalog_names")),
        sa.UniqueConstraint(
            "canonical_ingredient_id",
            name="uq_ingredient_catalog_names_canonical_ingredient",
        ),
        sa.UniqueConstraint(
            "ingredient_alias_id",
            name="uq_ingredient_catalog_names_ingredient_alias",
        ),
    )
    op.create_index(
        "uq_ingredient_catalog_names_normalized_digest",
        "ingredient_catalog_names",
        ["normalized_name_digest"],
        unique=True,
    )
    _backfill_catalog_names()
    _create_namespace_guards()


def downgrade() -> None:
    op.execute(sa.text(f"DROP TRIGGER IF EXISTS {_NAME_TRIGGER} ON ingredient_catalog_names"))
    op.execute(sa.text(f"DROP TRIGGER IF EXISTS {_ALIAS_TRIGGER} ON ingredient_aliases"))
    op.execute(sa.text(f"DROP TRIGGER IF EXISTS {_INGREDIENT_TRIGGER} ON ingredients"))
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {_NAME_GUARD_FUNCTION}()"))
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {_SOURCE_GUARD_FUNCTION}()"))
    op.drop_index(
        "uq_ingredient_catalog_names_normalized_digest",
        table_name="ingredient_catalog_names",
    )
    op.drop_table("ingredient_catalog_names")
