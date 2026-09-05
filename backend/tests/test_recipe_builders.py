from decimal import Decimal
from uuid import uuid4

from sqlalchemy import inspect

from tests.recipe_builders import (
    build_recipe_draft,
    build_recipe_lineage,
    build_recipe_version,
)


def test_recipe_builders_return_transient_records_with_stable_defaults() -> None:
    author_id = uuid4()
    lineage = build_recipe_lineage(created_by_user_id=author_id)
    version = build_recipe_version(
        lineage_id=lineage.id,
        created_by_user_id=author_id,
    )
    draft = build_recipe_draft(author_user_id=author_id)

    assert inspect(lineage).transient
    assert inspect(version).transient
    assert inspect(draft).transient
    assert version.title == "Test recipe"
    assert version.servings == Decimal("1.00")
    assert version.version_number == 1
    assert draft.title == ""
    assert draft.status == "active"
    assert draft.revision == 1


def test_recipe_builders_preserve_explicit_identity_and_optional_fields() -> None:
    author_id = uuid4()
    lineage_id = uuid4()
    version_id = uuid4()
    draft_id = uuid4()
    source_id = uuid4()

    lineage = build_recipe_lineage(
        created_by_user_id=author_id,
        lineage_id=lineage_id,
    )
    version = build_recipe_version(
        lineage_id=lineage_id,
        created_by_user_id=author_id,
        recipe_version_id=version_id,
        parent_version_id=source_id,
        version_number=2,
        title="Second version",
        description="Optional description",
        servings=Decimal("4.50"),
        notes="Optional note",
    )
    draft = build_recipe_draft(
        author_user_id=author_id,
        draft_id=draft_id,
        source_version_id=source_id,
        title="Draft title",
        servings=Decimal("3.00"),
    )

    assert lineage.id == lineage_id
    assert version.id == version_id
    assert version.parent_version_id == source_id
    assert version.description == "Optional description"
    assert version.notes == "Optional note"
    assert draft.id == draft_id
    assert draft.source_version_id == source_id
    assert draft.servings == Decimal("3.00")
