from decimal import Decimal
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    MAX_RATING,
    MIN_RATING,
    RecipeIngredient,
    RecipeInstruction,
    RecipeLineage,
    RecipeRating,
    RecipeSave,
    RecipeVersion,
    User,
)


def create_user(session: Session, email: str) -> User:
    user = User(email=email, display_name=email.split("@", maxsplit=1)[0])
    session.add(user)
    session.flush()
    return user


def create_lineage_with_root(
    session: Session,
    creator: User,
    *,
    title: str,
) -> tuple[RecipeLineage, RecipeVersion]:
    lineage = RecipeLineage(created_by_user_id=creator.id)
    session.add(lineage)
    session.flush()

    root = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=None,
        created_by_user_id=creator.id,
        version_number=1,
        title=title,
        description=None,
        servings=Decimal("8.00"),
    )
    session.add(root)
    session.flush()
    return lineage, root


def assert_flush_violates(
    session: Session,
    record: object,
    expected_constraint: str,
) -> None:
    with pytest.raises(IntegrityError) as error:
        with session.begin_nested():
            session.add(record)
            session.flush()

    assert_constraint_name(error.value, expected_constraint)


def assert_constraint_name(error: IntegrityError, expected_constraint: str) -> None:
    diagnostic = getattr(error.orig, "diag", None)
    actual_constraint = cast(str | None, getattr(diagnostic, "constraint_name", None))
    assert actual_constraint == expected_constraint


def test_version_can_have_one_parent_and_multiple_descendants(db_session: Session) -> None:
    creator = create_user(db_session, "lineage@example.com")
    lineage, root = create_lineage_with_root(db_session, creator, title="Carrot Cake")
    children = [
        RecipeVersion(
            lineage_id=lineage.id,
            parent_version_id=root.id,
            created_by_user_id=creator.id,
            version_number=version_number,
            title=title,
            description=None,
            servings=Decimal("8.00"),
        )
        for version_number, title in [(2, "Less Sugar"), (3, "Pecan Variant")]
    ]
    db_session.add_all(children)
    db_session.flush()

    db_session.expire(root, ["descendants"])
    db_session.expire(children[0], ["parent"])

    assert [version.id for version in root.descendants] == [child.id for child in children]
    assert children[0].parent is root
    assert all(child.parent_version_id == root.id for child in children)


def test_parent_version_must_belong_to_the_same_lineage(db_session: Session) -> None:
    creator = create_user(db_session, "cross-lineage@example.com")
    first_lineage, first_root = create_lineage_with_root(
        db_session,
        creator,
        title="First Recipe",
    )
    second_lineage, _ = create_lineage_with_root(
        db_session,
        creator,
        title="Second Recipe",
    )
    assert first_lineage.id != second_lineage.id

    invalid_child = RecipeVersion(
        lineage_id=second_lineage.id,
        parent_version_id=first_root.id,
        created_by_user_id=creator.id,
        version_number=2,
        title="Invalid Cross-Lineage Child",
        description=None,
        servings=Decimal("4.00"),
    )

    assert_flush_violates(
        db_session,
        invalid_child,
        "fk_recipe_versions_parent_same_lineage",
    )


def test_lineage_allows_only_one_root_version(db_session: Session) -> None:
    creator = create_user(db_session, "one-root@example.com")
    lineage, _ = create_lineage_with_root(db_session, creator, title="Original")
    second_root = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=None,
        created_by_user_id=creator.id,
        version_number=2,
        title="Second Root",
        description=None,
        servings=Decimal("4.00"),
    )

    assert_flush_violates(
        db_session,
        second_root,
        "uq_recipe_versions_one_root_per_lineage",
    )


def test_parent_version_cannot_be_deleted_while_descendants_exist(
    db_session: Session,
) -> None:
    creator = create_user(db_session, "protected-parent@example.com")
    lineage, root = create_lineage_with_root(db_session, creator, title="Parent")
    child = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=root.id,
        created_by_user_id=creator.id,
        version_number=2,
        title="Child",
        description=None,
        servings=Decimal("4.00"),
    )
    db_session.add(child)
    db_session.flush()

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.execute(delete(RecipeVersion).where(RecipeVersion.id == root.id))

    assert_constraint_name(error.value, "fk_recipe_versions_parent_same_lineage")


def test_recipe_version_parent_cannot_change_after_insert(db_session: Session) -> None:
    creator = create_user(db_session, "immutable-topology@example.com")
    lineage, root = create_lineage_with_root(db_session, creator, title="Root")
    child = RecipeVersion(
        lineage_id=lineage.id,
        parent_version_id=root.id,
        created_by_user_id=creator.id,
        version_number=2,
        title="Child",
        description=None,
        servings=Decimal("4.00"),
    )
    db_session.add(child)
    db_session.flush()

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.execute(
                update(RecipeVersion)
                .where(RecipeVersion.id == root.id)
                .values(parent_version_id=child.id)
            )

    assert_constraint_name(error.value, "ck_recipe_versions_topology_immutable")


def test_recipe_versions_cannot_be_inserted_as_a_cycle(db_session: Session) -> None:
    creator = create_user(db_session, "cyclic-insert@example.com")
    lineage = RecipeLineage(created_by_user_id=creator.id)
    db_session.add(lineage)
    db_session.flush()
    first_id = uuid4()
    second_id = uuid4()

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.execute(
                insert(RecipeVersion).values(
                    [
                        {
                            "id": first_id,
                            "lineage_id": lineage.id,
                            "parent_version_id": second_id,
                            "created_by_user_id": creator.id,
                            "version_number": 1,
                            "title": "Cyclic A",
                            "description": None,
                            "servings": Decimal("4.00"),
                        },
                        {
                            "id": second_id,
                            "lineage_id": lineage.id,
                            "parent_version_id": first_id,
                            "created_by_user_id": creator.id,
                            "version_number": 2,
                            "title": "Cyclic B",
                            "description": None,
                            "servings": Decimal("4.00"),
                        },
                    ]
                )
            )

    assert_constraint_name(error.value, "ck_recipe_versions_lineage_acyclic")


def test_ingredient_fields_and_display_order_round_trip(db_session: Session) -> None:
    creator = create_user(db_session, "ingredients@example.com")
    _, version = create_lineage_with_root(db_session, creator, title="Structured Ingredients")
    version.ingredients.extend(
        [
            RecipeIngredient(
                name="Salt",
                quantity=None,
                unit=None,
                preparation_notes="to taste",
                display_order=1,
            ),
            RecipeIngredient(
                name="Walnuts",
                quantity=Decimal("0.1250"),
                unit="cup",
                preparation_notes="toasted and chopped",
                display_order=0,
            ),
        ]
    )
    db_session.flush()
    db_session.expire(version, ["ingredients"])

    first, second = version.ingredients
    assert first.name == "Walnuts"
    assert first.quantity == Decimal("0.1250")
    assert first.unit == "cup"
    assert first.preparation_notes == "toasted and chopped"
    assert [ingredient.display_order for ingredient in version.ingredients] == [0, 1]
    assert second.quantity is None
    assert second.preparation_notes == "to taste"


def test_ingredient_constraints_reject_invalid_rows(db_session: Session) -> None:
    creator = create_user(db_session, "ingredient-constraints@example.com")
    _, version = create_lineage_with_root(db_session, creator, title="Ingredient Constraints")
    db_session.add(
        RecipeIngredient(
            recipe_version_id=version.id,
            name="Sugar",
            quantity=Decimal("180.0000"),
            unit="g",
            preparation_notes=None,
            display_order=0,
        )
    )
    db_session.flush()

    assert_flush_violates(
        db_session,
        RecipeIngredient(
            recipe_version_id=version.id,
            name="Flour",
            quantity=Decimal("250.0000"),
            unit="g",
            preparation_notes=None,
            display_order=0,
        ),
        "uq_recipe_version_ingredients_version_display_order",
    )
    assert_flush_violates(
        db_session,
        RecipeIngredient(
            recipe_version_id=version.id,
            name="Invalid Quantity",
            quantity=Decimal("0.0000"),
            unit="g",
            preparation_notes=None,
            display_order=1,
        ),
        "ck_recipe_version_ingredients_quantity_positive",
    )
    assert_flush_violates(
        db_session,
        RecipeIngredient(
            recipe_version_id=version.id,
            name="Invalid Position",
            quantity=Decimal("1.0000"),
            unit=None,
            preparation_notes=None,
            display_order=-1,
        ),
        "ck_recipe_version_ingredients_display_order_nonnegative",
    )


def test_instructions_are_ordered_and_positions_are_unique(db_session: Session) -> None:
    creator = create_user(db_session, "instructions@example.com")
    _, version = create_lineage_with_root(db_session, creator, title="Instructions")
    version.instructions.extend(
        [
            RecipeInstruction(instruction="Bake.", display_order=1),
            RecipeInstruction(instruction="Mix.", display_order=0),
        ]
    )
    db_session.flush()
    db_session.expire(version, ["instructions"])

    assert [step.instruction for step in version.instructions] == ["Mix.", "Bake."]
    assert_flush_violates(
        db_session,
        RecipeInstruction(
            recipe_version_id=version.id,
            instruction="Duplicate position.",
            display_order=0,
        ),
        "uq_recipe_version_instructions_version_display_order",
    )


def test_ratings_are_bounded_and_unique_per_user_and_version(db_session: Session) -> None:
    creator = create_user(db_session, "rating-author@example.com")
    low_rater = create_user(db_session, "low-rating@example.com")
    high_rater = create_user(db_session, "high-rating@example.com")
    invalid_low_rater = create_user(db_session, "invalid-low@example.com")
    invalid_high_rater = create_user(db_session, "invalid-high@example.com")
    _, version = create_lineage_with_root(db_session, creator, title="Rated Recipe")
    db_session.add_all(
        [
            RecipeRating(
                user_id=low_rater.id,
                recipe_version_id=version.id,
                rating=MIN_RATING,
            ),
            RecipeRating(
                user_id=high_rater.id,
                recipe_version_id=version.id,
                rating=MAX_RATING,
            ),
        ]
    )
    db_session.flush()

    assert_flush_violates(
        db_session,
        RecipeRating(
            user_id=invalid_low_rater.id,
            recipe_version_id=version.id,
            rating=MIN_RATING - 1,
        ),
        "ck_recipe_ratings_rating_supported_range",
    )
    assert_flush_violates(
        db_session,
        RecipeRating(
            user_id=invalid_high_rater.id,
            recipe_version_id=version.id,
            rating=MAX_RATING + 1,
        ),
        "ck_recipe_ratings_rating_supported_range",
    )

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.execute(
                insert(RecipeRating).values(
                    user_id=low_rater.id,
                    recipe_version_id=version.id,
                    rating=MAX_RATING,
                )
            )

    assert_constraint_name(error.value, "pk_recipe_ratings")


def test_saves_are_unique_per_user_and_version(db_session: Session) -> None:
    creator = create_user(db_session, "save-author@example.com")
    saver = create_user(db_session, "saver@example.com")
    _, version = create_lineage_with_root(db_session, creator, title="Saved Recipe")
    db_session.add(RecipeSave(user_id=saver.id, recipe_version_id=version.id))
    db_session.flush()

    with pytest.raises(IntegrityError) as error:
        with db_session.begin_nested():
            db_session.execute(
                insert(RecipeSave).values(
                    user_id=saver.id,
                    recipe_version_id=version.id,
                )
            )

    assert_constraint_name(error.value, "pk_recipe_saves")


def test_deleting_interaction_only_user_cascades_saves_and_ratings(
    db_session: Session,
) -> None:
    creator = create_user(db_session, "cascade-author@example.com")
    participant = create_user(db_session, "cascade-participant@example.com")
    _, version = create_lineage_with_root(db_session, creator, title="Interacted Recipe")
    db_session.add_all(
        [
            RecipeSave(user_id=participant.id, recipe_version_id=version.id),
            RecipeRating(
                user_id=participant.id,
                recipe_version_id=version.id,
                rating=MAX_RATING,
            ),
        ]
    )
    db_session.flush()

    db_session.execute(delete(User).where(User.id == participant.id))

    save_count = db_session.scalar(select(func.count()).select_from(RecipeSave))
    rating_count = db_session.scalar(select(func.count()).select_from(RecipeRating))
    assert save_count == 0
    assert rating_count == 0
