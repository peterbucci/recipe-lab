"""add immutable recipe duplicate preflight evidence

Revision ID: 20260825_0012
Revises: 20260825_0011
Create Date: 2026-08-25 13:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260825_0012"
down_revision: str | None = "20260825_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_IMMUTABLE_TABLES = (
    "recipe_duplicate_preflights",
    "recipe_duplicate_candidates",
    "recipe_duplicate_decisions",
)


def _create_immutable_evidence_triggers() -> None:
    op.execute(
        sa.text(
            """
            CREATE FUNCTION prevent_recipe_duplicate_evidence_mutation()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION 'recipe duplicate evidence is append-only';
            END;
            $$ LANGUAGE plpgsql
            """
        )
    )
    for table_name in _IMMUTABLE_TABLES:
        op.execute(
            sa.text(
                f"""
                CREATE TRIGGER {table_name}_append_only
                BEFORE UPDATE OR DELETE ON {table_name}
                FOR EACH ROW EXECUTE FUNCTION prevent_recipe_duplicate_evidence_mutation()
                """
            )
        )
        op.execute(
            sa.text(
                f"""
                CREATE TRIGGER {table_name}_no_truncate
                BEFORE TRUNCATE ON {table_name}
                FOR EACH STATEMENT EXECUTE FUNCTION prevent_recipe_duplicate_evidence_mutation()
                """
            )
        )


def upgrade() -> None:
    op.create_table(
        "recipe_duplicate_preflights",
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("action_id", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("source_version_id", sa.Uuid(), nullable=True),
        sa.Column("subject_fingerprint_algorithm", sa.String(length=64), nullable=False),
        sa.Column("subject_fingerprint_digest", sa.String(length=64), nullable=False),
        sa.Column("policy_version", sa.String(length=64), nullable=False),
        sa.Column("classification", sa.String(length=24), nullable=False),
        sa.Column(
            "same_parent_no_change",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("result_digest", sa.String(length=64), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "request_fingerprint ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_recipe_duplicate_preflights_request_sha256"),
        ),
        sa.CheckConstraint(
            "subject_fingerprint_algorithm ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name=op.f("ck_recipe_duplicate_preflights_subject_algorithm_format"),
        ),
        sa.CheckConstraint(
            "subject_fingerprint_digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_recipe_duplicate_preflights_subject_digest_sha256"),
        ),
        sa.CheckConstraint(
            "policy_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name=op.f("ck_recipe_duplicate_preflights_policy_version_format"),
        ),
        sa.CheckConstraint(
            "classification IN ('exact_duplicate', 'probable_duplicate', 'distinct')",
            name=op.f("ck_recipe_duplicate_preflights_classification_supported"),
        ),
        sa.CheckConstraint(
            "same_parent_no_change = false OR "
            "(classification = 'exact_duplicate' AND source_version_id IS NOT NULL)",
            name=op.f("ck_recipe_duplicate_preflights_same_parent_consistent"),
        ),
        sa.CheckConstraint(
            "result_digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_recipe_duplicate_preflights_result_digest_lowercase_sha256"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_recipe_duplicate_preflights_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["source_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_recipe_duplicate_preflights_source_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_duplicate_preflights")),
        sa.UniqueConstraint(
            "actor_user_id",
            "action_id",
            name="uq_recipe_duplicate_preflights_actor_action",
        ),
        sa.UniqueConstraint(
            "id",
            "actor_user_id",
            name="uq_recipe_duplicate_preflights_id_actor",
        ),
    )
    op.create_index(
        "ix_recipe_duplicate_preflights_actor_created_id",
        "recipe_duplicate_preflights",
        ["actor_user_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_recipe_duplicate_preflights_source_version_id",
        "recipe_duplicate_preflights",
        ["source_version_id"],
        unique=False,
    )

    op.create_table(
        "recipe_duplicate_candidates",
        sa.Column("preflight_id", sa.Uuid(), nullable=False),
        sa.Column("public_recipe_version_id", sa.Uuid(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("classification", sa.String(length=24), nullable=False),
        sa.Column("score_basis_points", sa.Integer(), nullable=False),
        sa.Column(
            "reason_codes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("fingerprint_algorithm_version", sa.String(length=64), nullable=False),
        sa.Column("policy_version", sa.String(length=64), nullable=False),
        sa.Column("exact_payload_confirmed", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "rank BETWEEN 1 AND 5",
            name=op.f("ck_recipe_duplicate_candidates_rank_bounded"),
        ),
        sa.CheckConstraint(
            "classification IN ('exact_duplicate', 'probable_duplicate')",
            name=op.f("ck_recipe_duplicate_candidates_classification_supported"),
        ),
        sa.CheckConstraint(
            "score_basis_points BETWEEN 0 AND 10000",
            name=op.f("ck_recipe_duplicate_candidates_score_basis_points_bounded"),
        ),
        sa.CheckConstraint(
            "jsonb_typeof(reason_codes) = 'array' "
            "AND jsonb_array_length(reason_codes) BETWEEN 1 AND 3",
            name=op.f("ck_recipe_duplicate_candidates_reason_codes_bounded_array"),
        ),
        sa.CheckConstraint(
            "fingerprint_algorithm_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name=op.f("ck_recipe_duplicate_candidates_fingerprint_version_format"),
        ),
        sa.CheckConstraint(
            "policy_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name=op.f("ck_recipe_duplicate_candidates_policy_version_format"),
        ),
        sa.CheckConstraint(
            "(classification = 'exact_duplicate' "
            "AND score_basis_points = 10000 AND exact_payload_confirmed = true) "
            "OR (classification = 'probable_duplicate' "
            "AND score_basis_points >= 8000 AND exact_payload_confirmed = false)",
            name=op.f("ck_recipe_duplicate_candidates_exact_evidence_consistent"),
        ),
        sa.ForeignKeyConstraint(
            ["preflight_id"],
            ["recipe_duplicate_preflights.id"],
            name=op.f("fk_recipe_duplicate_candidates_preflight_id_recipe_duplicate_preflights"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["public_recipe_version_id"],
            ["recipe_versions.id"],
            name=op.f("fk_recipe_duplicate_candidates_public_recipe_version_id_recipe_versions"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "preflight_id",
            "public_recipe_version_id",
            name=op.f("pk_recipe_duplicate_candidates"),
        ),
        sa.UniqueConstraint(
            "preflight_id",
            "rank",
            name="uq_recipe_duplicate_candidates_preflight_rank",
        ),
    )
    op.create_index(
        "ix_recipe_duplicate_candidates_public_version",
        "recipe_duplicate_candidates",
        ["public_recipe_version_id"],
        unique=False,
    )

    op.create_table(
        "recipe_duplicate_decisions",
        sa.Column("preflight_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=False),
        sa.Column("action_id", sa.Uuid(), nullable=False),
        sa.Column("decision", sa.String(length=16), nullable=False),
        sa.Column("acknowledged_policy_version", sa.String(length=64), nullable=False),
        sa.Column("acknowledged_result_digest", sa.String(length=64), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "decision IN ('continue', 'revise')",
            name=op.f("ck_recipe_duplicate_decisions_decision_supported"),
        ),
        sa.CheckConstraint(
            "acknowledged_policy_version ~ '^[a-z0-9]+(?:[._-][a-z0-9]+)*$'",
            name=op.f("ck_recipe_duplicate_decisions_ack_policy_format"),
        ),
        sa.CheckConstraint(
            "acknowledged_result_digest ~ '^[0-9a-f]{64}$'",
            name=op.f("ck_recipe_duplicate_decisions_ack_result_sha256"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_recipe_duplicate_decisions_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["preflight_id", "actor_user_id"],
            ["recipe_duplicate_preflights.id", "recipe_duplicate_preflights.actor_user_id"],
            name="fk_recipe_duplicate_decisions_preflight_actor",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_recipe_duplicate_decisions")),
        sa.UniqueConstraint(
            "preflight_id",
            name="uq_recipe_duplicate_decisions_preflight_id",
        ),
        sa.UniqueConstraint(
            "actor_user_id",
            "action_id",
            name="uq_recipe_duplicate_decisions_actor_action",
        ),
    )
    op.create_index(
        "ix_recipe_duplicate_decisions_actor_created_id",
        "recipe_duplicate_decisions",
        ["actor_user_id", "created_at", "id"],
        unique=False,
    )

    _create_immutable_evidence_triggers()


def downgrade() -> None:
    for table_name in reversed(_IMMUTABLE_TABLES):
        op.execute(sa.text(f"DROP TRIGGER {table_name}_no_truncate ON {table_name}"))
        op.execute(sa.text(f"DROP TRIGGER {table_name}_append_only ON {table_name}"))
    op.execute(sa.text("DROP FUNCTION prevent_recipe_duplicate_evidence_mutation()"))

    op.drop_index(
        "ix_recipe_duplicate_decisions_actor_created_id",
        table_name="recipe_duplicate_decisions",
    )
    op.drop_table("recipe_duplicate_decisions")
    op.drop_index(
        "ix_recipe_duplicate_candidates_public_version",
        table_name="recipe_duplicate_candidates",
    )
    op.drop_table("recipe_duplicate_candidates")
    op.drop_index(
        "ix_recipe_duplicate_preflights_source_version_id",
        table_name="recipe_duplicate_preflights",
    )
    op.drop_index(
        "ix_recipe_duplicate_preflights_actor_created_id",
        table_name="recipe_duplicate_preflights",
    )
    op.drop_table("recipe_duplicate_preflights")
