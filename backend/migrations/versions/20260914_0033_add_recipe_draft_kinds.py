"""add explicit recipe draft kinds

Revision ID: 20260914_0033
Revises: 20260914_0032
Create Date: 2026-09-14 14:00:00.000000

"""

import hashlib
import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260914_0033"
down_revision: str | None = "20260914_0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _creation_fingerprint(
    *,
    draft_kind: str,
    source_version_id: object | None,
    version: int,
) -> str:
    if version == 1:
        document = {
            "intent": "blank" if source_version_id is None else "source",
            "schema": "recipe-draft-creation",
            "source_version_id": (
                str(source_version_id) if source_version_id is not None else None
            ),
            "version": 1,
        }
    else:
        document = {
            "draft_kind": draft_kind,
            "schema": "recipe-draft-creation",
            "source_version_id": (
                str(source_version_id) if source_version_id is not None else None
            ),
            "version": 2,
        }
    payload = json.dumps(
        document,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _rebind_creation_fingerprints(*, version: int) -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT id, draft_kind, source_version_id FROM recipe_drafts "
            "WHERE creation_request_fingerprint IS NOT NULL ORDER BY id"
        )
    ).mappings()
    for row in rows:
        connection.execute(
            sa.text(
                "UPDATE recipe_drafts SET creation_request_fingerprint = :fingerprint "
                "WHERE id = :id"
            ),
            {
                "id": row["id"],
                "fingerprint": _creation_fingerprint(
                    draft_kind=str(row["draft_kind"]),
                    source_version_id=row["source_version_id"],
                    version=version,
                ),
            },
        )


def upgrade() -> None:
    op.add_column(
        "recipe_drafts",
        sa.Column("draft_kind", sa.String(length=16), nullable=True),
    )
    op.execute(
        """
        UPDATE recipe_drafts
        SET draft_kind = CASE
            WHEN source_version_id IS NULL THEN 'original'
            ELSE 'adaptation'
        END
        """
    )
    op.alter_column("recipe_drafts", "draft_kind", nullable=False)
    op.create_check_constraint(
        op.f("ck_recipe_drafts_draft_kind_supported"),
        "recipe_drafts",
        "draft_kind IN ('original', 'adaptation', 'revision')",
    )
    op.create_check_constraint(
        op.f("ck_recipe_drafts_draft_kind_source_shape_valid"),
        "recipe_drafts",
        "(draft_kind = 'original' AND source_version_id IS NULL) OR "
        "(draft_kind IN ('adaptation', 'revision') AND source_version_id IS NOT NULL)",
    )
    op.alter_column(
        "recipe_drafts",
        "draft_kind",
        server_default=sa.text("'original'"),
    )
    _rebind_creation_fingerprints(version=2)


def downgrade() -> None:
    revision_count = op.get_bind().scalar(
        sa.text("SELECT count(*) FROM recipe_drafts WHERE draft_kind = 'revision'")
    )
    if revision_count:
        raise RuntimeError("cannot downgrade recipe draft kinds while revision drafts exist")
    _rebind_creation_fingerprints(version=1)
    op.drop_constraint(
        op.f("ck_recipe_drafts_draft_kind_source_shape_valid"),
        "recipe_drafts",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_recipe_drafts_draft_kind_supported"),
        "recipe_drafts",
        type_="check",
    )
    op.drop_column("recipe_drafts", "draft_kind")
