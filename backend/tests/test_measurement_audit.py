import json
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine

from app import measurement_audit
from app.measurement_audit import canonical_audit_json
from app.seeds.identifiers import measurement_uuid


def _insert_unknown_legacy_measurement(connection: sa.Connection) -> str:
    user_id = uuid4()
    lineage_id = uuid4()
    version_id = uuid4()
    row_id = uuid4()
    metadata = sa.MetaData()
    users = sa.Table("users", metadata, autoload_with=connection)
    lineages = sa.Table("recipe_lineages", metadata, autoload_with=connection)
    versions = sa.Table("recipe_versions", metadata, autoload_with=connection)
    ingredients = sa.Table("recipe_version_ingredients", metadata, autoload_with=connection)
    connection.execute(
        users.insert().values(
            id=user_id,
            email="private-audit-owner@example.com",
            display_name="Private Audit Owner",
        )
    )
    connection.execute(lineages.insert().values(id=lineage_id, created_by_user_id=user_id))
    connection.execute(
        versions.insert().values(
            id=version_id,
            lineage_id=lineage_id,
            created_by_user_id=user_id,
            version_number=1,
            title="Audit-safe recipe title",
            servings=Decimal("2.00"),
        )
    )
    connection.execute(
        ingredients.insert().values(
            id=row_id,
            recipe_version_id=version_id,
            name="Brown Sugar",
            quantity=Decimal("3.0000"),
            unit=" mystery scoop ",
            display_order=0,
        )
    )
    return str(row_id)


def test_canonical_audit_json_is_sorted_compact_and_newline_terminated() -> None:
    first = canonical_audit_json({"z": [2, 1], "a": {"d": 4, "c": 3}})
    second = canonical_audit_json({"a": {"c": 3, "d": 4}, "z": [2, 1]})

    assert first == second == '{"a":{"c":3,"d":4},"z":[2,1]}\n'


def test_audit_cli_is_deterministic_safe_read_only_and_nonzero_for_unresolved(
    empty_postgres_engine: Engine,
    alembic_config: Config,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    with empty_postgres_engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.upgrade(alembic_config, "20260820_0002")
        row_id = _insert_unknown_legacy_measurement(connection)
        command.upgrade(alembic_config, "20260824_0008")

    from app.db import session as db_session

    monkeypatch.setattr(db_session, "engine", empty_postgres_engine)
    output_path = tmp_path / "nested" / "measurement-audit.json"
    before_revision: str | None
    with empty_postgres_engine.connect() as connection:
        before_revision = connection.scalar(sa.text("SELECT version_num FROM alembic_version"))

    assert (
        measurement_audit.main(["audit-legacy", "--format", "json", "--output", str(output_path)])
        == 2
    )
    first_bytes = output_path.read_bytes()
    assert (
        measurement_audit.main(["audit-legacy", "--format", "json", "--output", str(output_path)])
        == 2
    )
    assert output_path.read_bytes() == first_bytes

    report = json.loads(first_bytes)
    assert report["schema_state"] == "legacy"
    assert report["summary"]["unresolved_rows"] == 1
    assert report["summary"]["reason_counts"] == {"unknown_unit_label": 1}
    assert report["unresolved"][0]["row_id"] == row_id
    assert report["unresolved"][0]["legacy_unit"] == " mystery scoop "
    assert report["unresolved"][0]["normalized_unit"] == "mystery scoop"
    assert report["unit_mappings"] == []
    assert str(measurement_uuid("unit", "g")) not in first_bytes.decode()
    assert "private-audit-owner@example.com" not in first_bytes.decode()
    assert "Private Audit Owner" not in first_bytes.decode()
    assert first_bytes.endswith(b"\n")

    with empty_postgres_engine.connect() as connection:
        after_revision = connection.scalar(sa.text("SELECT version_num FROM alembic_version"))
        assert (
            connection.scalar(
                sa.text("SELECT unit FROM recipe_version_ingredients WHERE id = CAST(:id AS uuid)"),
                {"id": row_id},
            )
            == " mystery scoop "
        )
    assert after_revision == before_revision == "20260824_0008"
    assert capsys.readouterr().out == ""
