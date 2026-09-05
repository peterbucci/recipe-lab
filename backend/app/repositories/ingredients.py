from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased, contains_eager, joinedload, selectinload

from app.catalog_names import catalog_name_digest, normalize_catalog_name
from app.db.query import LIKE_ESCAPE, literal_contains_pattern
from app.models import (
    INGREDIENT_CATALOG_NAME_ALIAS,
    INGREDIENT_CATALOG_NAME_CANONICAL,
    Ingredient,
    IngredientAlias,
    IngredientCatalogName,
    IngredientSubstitution,
)


@dataclass(frozen=True, slots=True)
class IngredientCatalogBrowseResult:
    items: list[Ingredient]
    total: int


def browse_ingredients(
    session: Session,
    *,
    search: str | None,
    offset: int,
    limit: int,
) -> IngredientCatalogBrowseResult:
    """Browse curated identities with deterministic canonical/alias matching."""

    filters = []
    if search is not None:
        pattern = literal_contains_pattern(search)
        alias_matches = (
            select(IngredientAlias.id)
            .where(
                IngredientAlias.ingredient_id == Ingredient.id,
                IngredientAlias.alias.ilike(pattern, escape=LIKE_ESCAPE),
            )
            .exists()
        )
        filters.append(
            or_(
                Ingredient.canonical_name.ilike(pattern, escape=LIKE_ESCAPE),
                alias_matches,
            )
        )

    total = session.scalar(select(func.count()).select_from(Ingredient).where(*filters)) or 0
    statement = (
        select(Ingredient)
        .options(selectinload(Ingredient.aliases))
        .where(*filters)
        .order_by(
            func.lower(func.btrim(Ingredient.canonical_name)),
            func.btrim(Ingredient.canonical_name),
            Ingredient.id,
        )
        .offset(offset)
        .limit(limit)
    )
    return IngredientCatalogBrowseResult(items=list(session.scalars(statement)), total=total)


def find_ingredient_candidates(
    session: Session,
    *,
    search_terms: list[str],
    limit: int,
) -> list[Ingredient]:
    """Return bounded deterministic catalog candidates without inferring identity."""

    matches = []
    for term in search_terms:
        if not term:
            continue
        pattern = literal_contains_pattern(term)
        alias_matches = (
            select(IngredientAlias.id)
            .where(
                IngredientAlias.ingredient_id == Ingredient.id,
                IngredientAlias.alias.ilike(pattern, escape=LIKE_ESCAPE),
            )
            .exists()
        )
        matches.append(
            or_(
                Ingredient.canonical_name.ilike(pattern, escape=LIKE_ESCAPE),
                alias_matches,
            )
        )
    if not matches:
        return []

    statement = (
        select(Ingredient)
        .options(selectinload(Ingredient.aliases))
        .where(or_(*matches))
        .order_by(
            func.lower(func.btrim(Ingredient.canonical_name)),
            func.btrim(Ingredient.canonical_name),
            Ingredient.id,
        )
        .limit(limit)
    )
    return list(session.scalars(statement))


def get_ingredient(session: Session, ingredient_id: UUID) -> Ingredient | None:
    statement = (
        select(Ingredient)
        .options(selectinload(Ingredient.aliases))
        .where(Ingredient.id == ingredient_id)
    )
    return session.scalar(statement)


def find_catalog_name(
    session: Session,
    *,
    normalized_name: str,
    normalized_name_digest: str,
    include_owner: bool = False,
) -> IngredientCatalogName | None:
    """Resolve one normalized key through the shared indexed namespace."""

    statement = select(IngredientCatalogName).where(
        IngredientCatalogName.normalized_name_digest == normalized_name_digest,
        IngredientCatalogName.normalized_name == normalized_name,
    )
    if include_owner:
        statement = statement.options(
            joinedload(IngredientCatalogName.canonical_ingredient),
            joinedload(IngredientCatalogName.ingredient_alias).joinedload(
                IngredientAlias.ingredient
            ),
        )
    return session.scalar(statement)


def curated_display_label(ingredient: Ingredient, raw_label: str) -> str | None:
    """Return the stored catalog spelling when a label belongs to this identity."""

    normalized_label = normalize_catalog_name(raw_label)
    if normalize_catalog_name(ingredient.canonical_name) == normalized_label:
        return ingredient.canonical_name
    for alias in ingredient.aliases:
        if normalize_catalog_name(alias.alias) == normalized_label:
            return alias.alias
    return None


def resolve_ingredient_name(session: Session, raw_name: str) -> Ingredient | None:
    """Resolve one exact normalized name from the collision-free namespace."""

    normalized_name = normalize_catalog_name(raw_name)
    if not normalized_name:
        raise ValueError("ingredient name must not be blank")
    catalog_name = find_catalog_name(
        session,
        normalized_name=normalized_name,
        normalized_name_digest=catalog_name_digest(normalized_name),
        include_owner=True,
    )
    if catalog_name is None:
        return None
    if catalog_name.name_kind == INGREDIENT_CATALOG_NAME_CANONICAL:
        return catalog_name.canonical_ingredient
    if catalog_name.name_kind == INGREDIENT_CATALOG_NAME_ALIAS:
        ingredient_alias = catalog_name.ingredient_alias
        return ingredient_alias.ingredient if ingredient_alias is not None else None
    raise RuntimeError(f"Unsupported ingredient catalog name kind {catalog_name.name_kind!r}.")


def list_direct_substitutions(
    session: Session,
    source_ingredient_id: UUID,
) -> list[IngredientSubstitution]:
    """Return curated outgoing substitutions without inferring reverse or transitive edges."""

    replacement = aliased(Ingredient)
    statement = (
        select(IngredientSubstitution)
        .join(
            replacement,
            IngredientSubstitution.replacement_ingredient_id == replacement.id,
        )
        .options(
            contains_eager(
                IngredientSubstitution.replacement_ingredient,
                alias=replacement,
            )
        )
        .where(IngredientSubstitution.source_ingredient_id == source_ingredient_id)
        .order_by(
            IngredientSubstitution.confidence.desc().nulls_last(),
            func.lower(func.btrim(replacement.canonical_name)),
            replacement.id,
        )
    )
    return list(session.scalars(statement).all())
