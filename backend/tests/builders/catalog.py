from sqlalchemy.orm import Session

from app.models import Ingredient


def persist_catalog_ingredient(session: Session, canonical_name: str) -> Ingredient:
    """Persist one minimal catalog ingredient for a test scenario."""

    ingredient = Ingredient(canonical_name=canonical_name)
    session.add(ingredient)
    session.flush()
    return ingredient
