from decimal import Decimal
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import delete, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.catalog_names import catalog_name_digest
from app.models import (
    Allergen,
    DietaryFlag,
    Ingredient,
    IngredientAlias,
    IngredientCatalogName,
    IngredientCategory,
    IngredientSubstitution,
)
from tests.builders.catalog import persist_catalog_ingredient


def assert_constraint_name(error: IntegrityError, expected_constraint: str) -> None:
    diagnostic = getattr(error.orig, "diag", None)
    actual_constraint = cast(str | None, getattr(diagnostic, "constraint_name", None))
    assert actual_constraint == expected_constraint


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


def test_ingredient_metadata_round_trip(db_session: Session) -> None:
    category = IngredientCategory(name="Nuts and seeds")
    dietary_flag = DietaryFlag(name="Plant-based")
    allergen = Allergen(name="Tree nut")
    ingredient = Ingredient(
        canonical_name="Walnut",
        category=category,
        aliases=[IngredientAlias(alias="English walnut")],
        dietary_flags=[dietary_flag],
        allergens=[allergen],
    )
    db_session.add(ingredient)
    db_session.flush()
    ingredient_id = ingredient.id
    db_session.expire_all()

    loaded = db_session.get(Ingredient, ingredient_id)

    assert loaded is not None
    assert loaded.category is not None
    assert loaded.category.name == "Nuts and seeds"
    assert [alias.alias for alias in loaded.aliases] == ["English walnut"]
    assert {flag.name for flag in loaded.dietary_flags} == {"Plant-based"}
    assert {item.name for item in loaded.allergens} == {"Tree nut"}

    assert_flush_violates(
        db_session,
        IngredientCategory(name="  NUTS AND SEEDS "),
        "uq_ingredient_categories_name_normalized",
    )


def test_normalized_canonical_and_alias_names_are_unique(db_session: Session) -> None:
    green_onion = Ingredient(
        canonical_name="Green onion",
        aliases=[
            IngredientAlias(alias="Scallion"),
            IngredientAlias(alias="Spring onion"),
        ],
    )
    bell_pepper = Ingredient(canonical_name="Bell pepper")
    db_session.add_all([green_onion, bell_pepper])
    db_session.flush()

    assert_flush_violates(
        db_session,
        Ingredient(canonical_name=" green ONION "),
        "uq_ingredients_canonical_name_normalized",
    )
    assert_flush_violates(
        db_session,
        IngredientAlias(ingredient_id=bell_pepper.id, alias=" SCALLION "),
        "uq_ingredient_aliases_alias_normalized",
    )
    assert_flush_violates(
        db_session,
        Ingredient(canonical_name="  "),
        "ck_ingredients_canonical_name_not_blank",
    )
    assert_flush_violates(
        db_session,
        IngredientAlias(ingredient_id=bell_pepper.id, alias="  "),
        "ck_ingredient_aliases_alias_not_blank",
    )


def test_canonical_names_and_aliases_share_the_strong_normalized_namespace(
    db_session: Session,
) -> None:
    sage = Ingredient(canonical_name="Ｓａｇｅ   leaves")
    thyme = Ingredient(canonical_name="Thyme")
    db_session.add_all([sage, thyme])
    db_session.flush()

    namespace = sage.catalog_name
    assert namespace is not None
    assert namespace.display_name == "Ｓａｇｅ   leaves"
    assert namespace.normalized_name == "sage leaves"
    assert namespace.normalized_name_digest == catalog_name_digest("sage leaves")

    assert_flush_violates(
        db_session,
        IngredientAlias(ingredient_id=thyme.id, alias="sage leaves"),
        "uq_ingredient_catalog_names_normalized_digest",
    )


def test_catalog_namespace_tracks_source_renames_without_changing_display_text(
    db_session: Session,
) -> None:
    ingredient = Ingredient(
        canonical_name="Fresh herb",
        aliases=[IngredientAlias(alias="Garden herb")],
    )
    db_session.add(ingredient)
    db_session.flush()

    ingredient.canonical_name = "  ＦＲＥＳＨ   herb  "
    ingredient.aliases[0].alias = " GARDEN\therb "
    db_session.flush()

    assert ingredient.catalog_name is not None
    assert ingredient.catalog_name.display_name == "  ＦＲＥＳＨ   herb  "
    assert ingredient.catalog_name.normalized_name == "fresh herb"
    assert ingredient.aliases[0].catalog_name is not None
    assert ingredient.aliases[0].catalog_name.display_name == " GARDEN\therb "
    assert ingredient.aliases[0].catalog_name.normalized_name == "garden herb"


def test_database_rejects_sources_without_namespace_and_tampered_namespace_rows(
    db_session: Session,
) -> None:
    missing_namespace_id = uuid4()
    with pytest.raises(IntegrityError) as missing_error:
        with db_session.begin_nested():
            db_session.execute(
                text(
                    "INSERT INTO ingredients (id, canonical_name) "
                    "VALUES (:ingredient_id, 'Unindexed herb')"
                ),
                {"ingredient_id": missing_namespace_id},
            )
            db_session.execute(
                text("SET CONSTRAINTS ingredient_catalog_name_namespace_required IMMEDIATE")
            )
    assert_constraint_name(
        missing_error.value,
        "ingredient_catalog_name_namespace_required",
    )

    ingredient = Ingredient(canonical_name="Indexed herb")
    db_session.add(ingredient)
    db_session.flush()
    assert ingredient.catalog_name is not None

    missing_alias_id = uuid4()
    with pytest.raises(IntegrityError) as missing_alias_error:
        with db_session.begin_nested():
            db_session.execute(
                text(
                    "INSERT INTO ingredient_aliases (id, ingredient_id, alias) "
                    "VALUES (:alias_id, :ingredient_id, 'Unindexed alias')"
                ),
                {"alias_id": missing_alias_id, "ingredient_id": ingredient.id},
            )
            db_session.execute(
                text("SET CONSTRAINTS ingredient_alias_catalog_name_namespace_required IMMEDIATE")
            )
    assert_constraint_name(
        missing_alias_error.value,
        "ingredient_alias_catalog_name_namespace_required",
    )

    with pytest.raises(IntegrityError) as digest_error:
        with db_session.begin_nested():
            db_session.execute(
                update(IngredientCatalogName)
                .where(IngredientCatalogName.id == ingredient.catalog_name.id)
                .values(normalized_name_digest="0" * 64)
            )
    assert_constraint_name(
        digest_error.value,
        "ck_ingredient_catalog_names_normalized_name_digest_matches",
    )

    with pytest.raises(IntegrityError) as delete_error:
        with db_session.begin_nested():
            db_session.execute(
                delete(IngredientCatalogName).where(
                    IngredientCatalogName.id == ingredient.catalog_name.id
                )
            )
            db_session.execute(
                text("SET CONSTRAINTS ingredient_catalog_name_source_matches IMMEDIATE")
            )
    assert_constraint_name(
        delete_error.value,
        "ingredient_catalog_name_namespace_required",
    )


def test_substitution_pairs_are_directed_and_unique(db_session: Session) -> None:
    source = persist_catalog_ingredient(db_session, "Source")
    replacement = persist_catalog_ingredient(db_session, "Replacement")
    db_session.add_all(
        [
            IngredientSubstitution(
                source_ingredient_id=source.id,
                replacement_ingredient_id=replacement.id,
                quantity_ratio=Decimal("1.0000"),
                provenance="Forward fixture",
            ),
            IngredientSubstitution(
                source_ingredient_id=replacement.id,
                replacement_ingredient_id=source.id,
                quantity_ratio=Decimal("1.0000"),
                provenance="Reverse fixture",
            ),
        ]
    )
    db_session.flush()

    assert_flush_violates(
        db_session,
        IngredientSubstitution(
            source_ingredient_id=source.id,
            replacement_ingredient_id=replacement.id,
            quantity_ratio=Decimal("0.5000"),
            provenance="Duplicate fixture",
        ),
        "uq_ingredient_substitutions_source_replacement",
    )


def test_substitution_ingredients_are_protected_from_deletion(
    db_session: Session,
) -> None:
    source = persist_catalog_ingredient(db_session, "Protected substitution source")
    replacement = persist_catalog_ingredient(db_session, "Protected substitution replacement")
    db_session.add(
        IngredientSubstitution(
            source_ingredient_id=source.id,
            replacement_ingredient_id=replacement.id,
            quantity_ratio=Decimal("1.0000"),
            provenance="Deletion protection fixture",
        )
    )
    db_session.flush()

    protected_deletes = [
        (
            delete(Ingredient).where(Ingredient.id == source.id),
            "fk_ingredient_substitutions_source_ingredient",
        ),
        (
            delete(Ingredient).where(Ingredient.id == replacement.id),
            "fk_ingredient_substitutions_replacement_ingredient",
        ),
    ]
    for statement, expected_constraint in protected_deletes:
        with pytest.raises(IntegrityError) as error:
            with db_session.begin_nested():
                db_session.execute(statement)

        assert_constraint_name(error.value, expected_constraint)


def test_substitution_constraints_reject_unexplainable_edges(
    db_session: Session,
) -> None:
    source = persist_catalog_ingredient(db_session, "Constraint source")
    replacement = persist_catalog_ingredient(db_session, "Constraint replacement")

    assert_flush_violates(
        db_session,
        IngredientSubstitution(
            source_ingredient_id=source.id,
            replacement_ingredient_id=source.id,
            quantity_ratio=Decimal("1.0000"),
            provenance="Self fixture",
        ),
        "ck_ingredient_substitutions_ingredients_must_differ",
    )
    assert_flush_violates(
        db_session,
        IngredientSubstitution(
            source_ingredient_id=source.id,
            replacement_ingredient_id=replacement.id,
            quantity_ratio=Decimal("0.0000"),
            provenance="Ratio fixture",
        ),
        "ck_ingredient_substitutions_quantity_ratio_positive",
    )
    assert_flush_violates(
        db_session,
        IngredientSubstitution(
            source_ingredient_id=source.id,
            replacement_ingredient_id=replacement.id,
            quantity_ratio=None,
            guidance=None,
            provenance="Missing quantity fixture",
        ),
        "ck_ingredient_substitutions_ratio_or_guidance_required",
    )
    assert_flush_violates(
        db_session,
        IngredientSubstitution(
            source_ingredient_id=source.id,
            replacement_ingredient_id=replacement.id,
            quantity_ratio=Decimal("1.0000"),
            provenance=None,
            confidence=None,
        ),
        "ck_ingredient_substitutions_provenance_or_confidence_required",
    )
    assert_flush_violates(
        db_session,
        IngredientSubstitution(
            source_ingredient_id=source.id,
            replacement_ingredient_id=replacement.id,
            quantity_ratio=Decimal("1.0000"),
            provenance="Confidence fixture",
            confidence=Decimal("1.0001"),
        ),
        "ck_ingredient_substitutions_confidence_supported_range",
    )
    assert_flush_violates(
        db_session,
        IngredientSubstitution(
            source_ingredient_id=source.id,
            replacement_ingredient_id=replacement.id,
            quantity_ratio=Decimal("1.0000"),
            guidance="  ",
            provenance="Blank guidance fixture",
        ),
        "ck_ingredient_substitutions_guidance_not_blank",
    )
    assert_flush_violates(
        db_session,
        IngredientSubstitution(
            source_ingredient_id=source.id,
            replacement_ingredient_id=replacement.id,
            quantity_ratio=Decimal("1.0000"),
            notes="  ",
            provenance="Blank notes fixture",
        ),
        "ck_ingredient_substitutions_notes_not_blank",
    )


def test_assigned_vocabularies_are_protected_from_deletion(db_session: Session) -> None:
    category = IngredientCategory(name="Protected category")
    dietary_flag = DietaryFlag(name="Protected flag")
    allergen = Allergen(name="Protected allergen")
    ingredient = Ingredient(
        canonical_name="Protected ingredient",
        category=category,
        dietary_flags=[dietary_flag],
        allergens=[allergen],
    )
    db_session.add(ingredient)
    db_session.flush()

    protected_deletes = [
        (
            delete(IngredientCategory).where(IngredientCategory.id == category.id),
            "fk_ingredients_category_id_ingredient_categories",
        ),
        (
            delete(DietaryFlag).where(DietaryFlag.id == dietary_flag.id),
            "fk_ingredient_dietary_flags_dietary_flag_id_dietary_flags",
        ),
        (
            delete(Allergen).where(Allergen.id == allergen.id),
            "fk_ingredient_allergens_allergen_id_allergens",
        ),
    ]
    for statement, expected_constraint in protected_deletes:
        with pytest.raises(IntegrityError) as error:
            with db_session.begin_nested():
                db_session.execute(statement)

        assert_constraint_name(error.value, expected_constraint)
