from decimal import Decimal
from typing import cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    RECIPE_DECLARED_CHANGE_REASON_CORRECTION,
    RECIPE_RELATION_KIND_ADAPTATION,
    RECIPE_RELATION_KIND_ORIGINAL,
    RECIPE_RELATION_KIND_REVISION,
    Recipe,
    RecipeEdition,
    RecipeLineage,
    RecipeVersion,
    RecipeVersionPublication,
    User,
)


def _constraint_name(error: IntegrityError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    return cast(str | None, getattr(diagnostic, "constraint_name", None))


def _force_deferred_constraints(session: Session, constraint: str = "ALL") -> None:
    session.execute(text(f"SET CONSTRAINTS {constraint} IMMEDIATE"))


def _restore_deferred_constraints(session: Session) -> None:
    session.execute(text("SET CONSTRAINTS ALL DEFERRED"))


def _create_user(session: Session, label: str) -> User:
    user = User(email=f"{label}@example.test", display_name=label)
    session.add(user)
    session.flush()
    return user


def _create_lineage(session: Session, author: User) -> RecipeLineage:
    lineage = RecipeLineage(created_by_user_id=author.id)
    session.add(lineage)
    session.flush()
    return lineage


def _create_version(
    session: Session,
    *,
    lineage: RecipeLineage,
    author: User,
    version_number: int,
    parent_version_id: UUID | None,
    title: str,
) -> RecipeVersion:
    version = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=parent_version_id,
        created_by_user_id=author.id,
        version_number=version_number,
        title=title,
        description=None,
        servings=Decimal("4.00"),
    )
    session.add(version)
    session.flush()
    return version


def _publish_first_edition(
    session: Session,
    *,
    version: RecipeVersion,
    author: User,
    relation_kind: str,
    recipe_id: UUID | None = None,
) -> tuple[Recipe, RecipeEdition]:
    stable_id = recipe_id or uuid4()
    recipe = Recipe(
        id=stable_id,
        lineage_id=version.lineage_id,
        attributed_author_user_id=author.id,
        owner_user_id=author.id,
        current_recipe_version_id=version.id,
    )
    publication = RecipeVersionPublication(
        recipe_version_id=version.id,
        actor_user_id=author.id,
    )
    edition = RecipeEdition(
        recipe_version_id=version.id,
        recipe_id=stable_id,
        lineage_id=version.lineage_id,
        attributed_author_user_id=author.id,
        edition_number=1,
        relation_kind=relation_kind,
        previous_recipe_version_id=None,
        declared_change_reason=None,
    )
    session.add_all((recipe, publication, edition))
    session.flush()
    _force_deferred_constraints(session)
    _restore_deferred_constraints(session)
    return recipe, edition


def test_stable_recipe_and_first_edition_flush_without_an_orm_cycle(
    db_session: Session,
) -> None:
    author = _create_user(db_session, "edition-cycle")
    lineage = _create_lineage(db_session, author)
    version_id = uuid4()
    recipe_id = uuid4()
    version = RecipeVersion(
        id=version_id,
        lineage_id=lineage.id,
        parent_version_id=None,
        created_by_user_id=author.id,
        version_number=1,
        title="Atomic first edition",
        description=None,
        servings=Decimal("2.00"),
    )
    recipe = Recipe(
        id=recipe_id,
        lineage_id=lineage.id,
        attributed_author_user_id=author.id,
        owner_user_id=author.id,
        current_recipe_version_id=version_id,
    )
    publication = RecipeVersionPublication(
        recipe_version_id=version_id,
        actor_user_id=author.id,
    )
    edition = RecipeEdition(
        recipe_version_id=version_id,
        recipe_id=recipe_id,
        lineage_id=lineage.id,
        attributed_author_user_id=author.id,
        edition_number=1,
        relation_kind=RECIPE_RELATION_KIND_ORIGINAL,
        previous_recipe_version_id=None,
        declared_change_reason=None,
    )

    db_session.add_all((version, recipe, publication, edition))
    db_session.flush()
    _force_deferred_constraints(db_session)
    _restore_deferred_constraints(db_session)

    db_session.expire(recipe, ["editions", "current_edition"])
    assert [item.recipe_version_id for item in recipe.editions] == [version_id]
    assert recipe.current_edition.recipe_version_id == version_id


def test_revision_uses_recipe_local_order_and_advances_current_atomically(
    db_session: Session,
) -> None:
    author = _create_user(db_session, "edition-revision")
    lineage = _create_lineage(db_session, author)
    first = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=1,
        parent_version_id=None,
        title="First edition",
    )
    recipe, first_edition = _publish_first_edition(
        db_session,
        version=first,
        author=author,
        relation_kind=RECIPE_RELATION_KIND_ORIGINAL,
    )
    second = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=2,
        parent_version_id=None,
        title="Corrected edition",
    )
    second_publication = RecipeVersionPublication(
        recipe_version_id=second.id,
        actor_user_id=author.id,
    )
    second_edition = RecipeEdition(
        recipe_version_id=second.id,
        recipe_id=recipe.id,
        lineage_id=lineage.id,
        attributed_author_user_id=author.id,
        edition_number=2,
        relation_kind=RECIPE_RELATION_KIND_REVISION,
        previous_recipe_version_id=first.id,
        declared_change_reason=RECIPE_DECLARED_CHANGE_REASON_CORRECTION,
    )
    recipe.current_recipe_version_id = second.id
    db_session.add_all((second_publication, second_edition))

    db_session.flush()
    _force_deferred_constraints(db_session)
    _restore_deferred_constraints(db_session)

    db_session.expire(recipe, ["editions", "current_edition"])
    assert [item.edition_number for item in recipe.editions] == [1, 2]
    assert recipe.current_edition.recipe_version_id == second.id
    assert first_edition.recipe_version_id == first.id
    assert second.parent_version_id is None
    assert second.version_number == 2


def test_current_pointer_must_belong_to_the_same_recipe(db_session: Session) -> None:
    first_author = _create_user(db_session, "current-owner-a")
    second_author = _create_user(db_session, "current-owner-b")
    first_lineage = _create_lineage(db_session, first_author)
    second_lineage = _create_lineage(db_session, second_author)
    first_version = _create_version(
        db_session,
        lineage=first_lineage,
        author=first_author,
        version_number=1,
        parent_version_id=None,
        title="Current A",
    )
    second_version = _create_version(
        db_session,
        lineage=second_lineage,
        author=second_author,
        version_number=1,
        parent_version_id=None,
        title="Current B",
    )
    first_recipe, _ = _publish_first_edition(
        db_session,
        version=first_version,
        author=first_author,
        relation_kind=RECIPE_RELATION_KIND_ORIGINAL,
    )
    _publish_first_edition(
        db_session,
        version=second_version,
        author=second_author,
        relation_kind=RECIPE_RELATION_KIND_ORIGINAL,
    )

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            first_recipe.current_recipe_version_id = second_version.id
            db_session.flush()
            _force_deferred_constraints(
                db_session,
                "fk_recipes_current_edition_same_recipe",
            )

    assert _constraint_name(error.value) == "fk_recipes_current_edition_same_recipe"


def test_publication_without_stable_edition_membership_is_rejected(
    db_session: Session,
) -> None:
    author = _create_user(db_session, "missing-edition")
    lineage = _create_lineage(db_session, author)
    version = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=1,
        parent_version_id=None,
        title="Missing edition",
    )

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add(
                RecipeVersionPublication(
                    recipe_version_id=version.id,
                    actor_user_id=author.id,
                )
            )
            db_session.flush()
            _force_deferred_constraints(db_session)

    assert _constraint_name(error.value) == "ck_recipe_publications_have_edition"


def test_lineage_allows_only_one_published_original_recipe(db_session: Session) -> None:
    author = _create_user(db_session, "duplicate-origin")
    lineage = _create_lineage(db_session, author)
    first = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=1,
        parent_version_id=None,
        title="Published origin",
    )
    _publish_first_edition(
        db_session,
        version=first,
        author=author,
        relation_kind=RECIPE_RELATION_KIND_ORIGINAL,
    )
    second = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=2,
        parent_version_id=None,
        title="Conflicting origin",
    )
    second_recipe_id = uuid4()

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add_all(
                (
                    Recipe(
                        id=second_recipe_id,
                        lineage_id=lineage.id,
                        attributed_author_user_id=author.id,
                        owner_user_id=author.id,
                        current_recipe_version_id=second.id,
                    ),
                    RecipeVersionPublication(
                        recipe_version_id=second.id,
                        actor_user_id=author.id,
                    ),
                    RecipeEdition(
                        recipe_version_id=second.id,
                        recipe_id=second_recipe_id,
                        lineage_id=lineage.id,
                        attributed_author_user_id=author.id,
                        edition_number=1,
                        relation_kind=RECIPE_RELATION_KIND_ORIGINAL,
                        previous_recipe_version_id=None,
                        declared_change_reason=None,
                    ),
                )
            )
            db_session.flush()

    assert _constraint_name(error.value) == "uq_recipe_editions_one_origin_per_lineage"


def test_relation_kind_must_match_the_exact_adaptation_parent(db_session: Session) -> None:
    author = _create_user(db_session, "relation-shape")
    lineage = _create_lineage(db_session, author)
    version = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=1,
        parent_version_id=None,
        title="Not an adaptation",
    )
    recipe_id = uuid4()

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add_all(
                (
                    Recipe(
                        id=recipe_id,
                        lineage_id=lineage.id,
                        attributed_author_user_id=author.id,
                        owner_user_id=author.id,
                        current_recipe_version_id=version.id,
                    ),
                    RecipeVersionPublication(
                        recipe_version_id=version.id,
                        actor_user_id=author.id,
                    ),
                    RecipeEdition(
                        recipe_version_id=version.id,
                        recipe_id=recipe_id,
                        lineage_id=lineage.id,
                        attributed_author_user_id=author.id,
                        edition_number=1,
                        relation_kind=RECIPE_RELATION_KIND_ADAPTATION,
                        previous_recipe_version_id=None,
                        declared_change_reason=None,
                    ),
                )
            )
            db_session.flush()
            _force_deferred_constraints(db_session)

    assert _constraint_name(error.value) == "ck_recipe_editions_adaptation_has_parent"


def test_revision_must_immediately_follow_a_predecessor_in_the_same_recipe(
    db_session: Session,
) -> None:
    author = _create_user(db_session, "wrong-predecessor")
    adapter = _create_user(db_session, "wrong-predecessor-adapter")
    lineage = _create_lineage(db_session, author)
    original = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=1,
        parent_version_id=None,
        title="Original",
    )
    original_recipe, _ = _publish_first_edition(
        db_session,
        version=original,
        author=author,
        relation_kind=RECIPE_RELATION_KIND_ORIGINAL,
    )
    adaptation = _create_version(
        db_session,
        lineage=lineage,
        author=adapter,
        version_number=2,
        parent_version_id=original.id,
        title="Adaptation",
    )
    _publish_first_edition(
        db_session,
        version=adaptation,
        author=adapter,
        relation_kind=RECIPE_RELATION_KIND_ADAPTATION,
    )
    revision = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=3,
        parent_version_id=None,
        title="Revision with wrong predecessor",
    )

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add_all(
                (
                    RecipeVersionPublication(
                        recipe_version_id=revision.id,
                        actor_user_id=author.id,
                    ),
                    RecipeEdition(
                        recipe_version_id=revision.id,
                        recipe_id=original_recipe.id,
                        lineage_id=lineage.id,
                        attributed_author_user_id=author.id,
                        edition_number=2,
                        relation_kind=RECIPE_RELATION_KIND_REVISION,
                        previous_recipe_version_id=adaptation.id,
                        declared_change_reason=None,
                    ),
                )
            )
            original_recipe.current_recipe_version_id = revision.id
            db_session.flush()
            _force_deferred_constraints(
                db_session,
                "fk_recipe_editions_previous_same_recipe",
            )

    assert _constraint_name(error.value) == "fk_recipe_editions_previous_same_recipe"


def test_current_pointer_cannot_lag_a_newer_edition(db_session: Session) -> None:
    author = _create_user(db_session, "stale-current")
    lineage = _create_lineage(db_session, author)
    first = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=1,
        parent_version_id=None,
        title="Current first",
    )
    recipe, _ = _publish_first_edition(
        db_session,
        version=first,
        author=author,
        relation_kind=RECIPE_RELATION_KIND_ORIGINAL,
    )
    second = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=2,
        parent_version_id=None,
        title="Unselected second",
    )

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.add_all(
                (
                    RecipeVersionPublication(
                        recipe_version_id=second.id,
                        actor_user_id=author.id,
                    ),
                    RecipeEdition(
                        recipe_version_id=second.id,
                        recipe_id=recipe.id,
                        lineage_id=lineage.id,
                        attributed_author_user_id=author.id,
                        edition_number=2,
                        relation_kind=RECIPE_RELATION_KIND_REVISION,
                        previous_recipe_version_id=first.id,
                        declared_change_reason=None,
                    ),
                )
            )
            db_session.flush()
            _force_deferred_constraints(db_session)

    assert _constraint_name(error.value) == "ck_recipes_current_edition_is_latest"


def test_editions_are_append_only_but_owner_authority_can_be_cleared(
    db_session: Session,
) -> None:
    author = _create_user(db_session, "append-only-edition")
    lineage = _create_lineage(db_session, author)
    version = _create_version(
        db_session,
        lineage=lineage,
        author=author,
        version_number=1,
        parent_version_id=None,
        title="Immutable edition",
    )
    recipe, edition = _publish_first_edition(
        db_session,
        version=version,
        author=author,
        relation_kind=RECIPE_RELATION_KIND_ORIGINAL,
    )

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.execute(
                update(RecipeEdition)
                .where(RecipeEdition.recipe_version_id == edition.recipe_version_id)
                .values(relation_kind=RECIPE_RELATION_KIND_ADAPTATION)
            )

    assert _constraint_name(error.value) == "ck_recipe_editions_append_only"

    original_current = recipe.current_recipe_version_id
    recipe.owner_user_id = None
    db_session.flush()
    assert recipe.owner_user_id is None
    assert recipe.current_recipe_version_id == original_current
