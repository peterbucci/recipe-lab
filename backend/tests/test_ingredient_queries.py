from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.models import Ingredient, IngredientAlias, IngredientSubstitution
from app.repositories.ingredients import (
    list_direct_substitutions,
    resolve_ingredient_name,
)


def create_ingredient(session: Session, canonical_name: str) -> Ingredient:
    ingredient = Ingredient(canonical_name=canonical_name)
    session.add(ingredient)
    session.flush()
    return ingredient


def test_exact_canonical_and_alias_names_resolve_case_insensitively(
    db_session: Session,
) -> None:
    green_onion = Ingredient(
        canonical_name="Green onion",
        aliases=[
            IngredientAlias(alias="Scallion"),
            IngredientAlias(alias="Spring onion"),
        ],
    )
    db_session.add(green_onion)
    db_session.flush()

    canonical_match = resolve_ingredient_name(db_session, "  GREEN ONION ")
    alias_match = resolve_ingredient_name(db_session, "  sCaLlIoN  ")

    assert canonical_match is green_onion
    assert alias_match is green_onion
    assert resolve_ingredient_name(db_session, "shallot") is None
    with pytest.raises(ValueError, match="must not be blank"):
        resolve_ingredient_name(db_session, "   ")


def test_substitution_lookup_returns_only_direct_outgoing_edges(
    db_session: Session,
) -> None:
    butter = create_ingredient(db_session, "Butter")
    coconut_oil = create_ingredient(db_session, "Coconut oil")
    applesauce = create_ingredient(db_session, "Applesauce")
    olive_oil = create_ingredient(db_session, "Olive oil")
    salt = create_ingredient(db_session, "Salt")
    db_session.add_all(
        [
            IngredientSubstitution(
                source_ingredient_id=butter.id,
                replacement_ingredient_id=coconut_oil.id,
                quantity_ratio=Decimal("0.7500"),
                guidance=None,
                notes="Best in baked goods.",
                provenance="Recipe Lab test fixture",
                confidence=Decimal("0.9500"),
            ),
            IngredientSubstitution(
                source_ingredient_id=butter.id,
                replacement_ingredient_id=applesauce.id,
                quantity_ratio=Decimal("0.5000"),
                guidance="Reduce other liquids if needed.",
                notes=None,
                provenance="Recipe Lab test fixture",
                confidence=None,
            ),
            IngredientSubstitution(
                source_ingredient_id=butter.id,
                replacement_ingredient_id=olive_oil.id,
                quantity_ratio=None,
                guidance="Add gradually to reach the desired texture.",
                notes=None,
                provenance="Recipe Lab test fixture",
                confidence=None,
            ),
            IngredientSubstitution(
                source_ingredient_id=applesauce.id,
                replacement_ingredient_id=butter.id,
                quantity_ratio=Decimal("2.0000"),
                guidance=None,
                notes=None,
                provenance="Recipe Lab test fixture",
                confidence=Decimal("0.8000"),
            ),
        ]
    )
    db_session.flush()

    substitutions = list_direct_substitutions(db_session, butter.id)

    assert [item.replacement_ingredient_id for item in substitutions] == [
        coconut_oil.id,
        applesauce.id,
        olive_oil.id,
    ]
    assert substitutions[0].quantity_ratio == Decimal("0.7500")
    assert substitutions[0].notes == "Best in baked goods."
    assert substitutions[0].provenance == "Recipe Lab test fixture"
    assert substitutions[0].confidence == Decimal("0.9500")
    assert list_direct_substitutions(db_session, salt.id) == []

    db_session.expunge_all()
    assert [item.replacement_ingredient.canonical_name for item in substitutions] == [
        "Coconut oil",
        "Applesauce",
        "Olive oil",
    ]
