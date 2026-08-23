from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from sqlalchemy import ColumnElement, func, select, text
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.core.demo_identity import (
    DEMO_USER_CREATED_AT,
    DEMO_USER_DISPLAY_NAME,
    DEMO_USER_EMAIL,
    DEMO_USER_ID,
    DEMO_USER_KEY,
)
from app.models import (
    ACCOUNT_KIND_DEMO,
    ACCOUNT_KIND_SYSTEM,
    Allergen,
    DietaryFlag,
    Ingredient,
    IngredientAlias,
    IngredientCategory,
    IngredientSubstitution,
    RecipeIngredient,
    RecipeInstruction,
    RecipeLineage,
    RecipeVersion,
    User,
)
from app.seeds.identifiers import seed_uuid
from app.seeds.schema import (
    IngredientSeed,
    NamedSeed,
    RecipeIngredientSeed,
    RecipeInstructionSeed,
    RecipeSeed,
    SeedCatalog,
    SubstitutionSeed,
)

CATALOG_USER_KEY = "catalog-author"
CATALOG_USER_EMAIL = "demo-catalog@recipe-lab.invalid"
CATALOG_USER_DISPLAY_NAME = "Recipe Lab Demo Catalog"
SEED_ADVISORY_LOCK_ID = 0x52435005


class SeedConflictError(RuntimeError):
    """Raised when existing data conflicts with the deterministic catalog."""


@dataclass
class SeedReport:
    created: Counter[str] = field(default_factory=Counter)
    reused: Counter[str] = field(default_factory=Counter)

    @property
    def created_total(self) -> int:
        return self.created.total()

    @property
    def reused_total(self) -> int:
        return self.reused.total()


def _conflict(entity: str, stable_key: str, detail: str) -> SeedConflictError:
    return SeedConflictError(f"seed conflict for {entity} {stable_key!r}: {detail}")


def _normalized_match(
    column: InstrumentedAttribute[str],
    value: str,
) -> ColumnElement[bool]:
    return func.lower(func.btrim(column)) == func.lower(value)


def _get_or_create_category(
    session: Session,
    catalog: SeedCatalog,
    seed: NamedSeed,
    report: SeedReport,
) -> IngredientCategory:
    existing = session.scalars(
        select(IngredientCategory).where(_normalized_match(IngredientCategory.name, seed.name))
    ).one_or_none()
    expected_id = seed_uuid(catalog.metadata.dataset_id, "ingredient-category", seed.key)
    if existing is not None:
        id_owner = session.get(IngredientCategory, expected_id)
        if id_owner is not None and id_owner.id != existing.id:
            raise _conflict("ingredient category", seed.key, "deterministic UUID is already used")
        report.reused["ingredient_categories"] += 1
        return existing

    if session.get(IngredientCategory, expected_id) is not None:
        raise _conflict("ingredient category", seed.key, "deterministic UUID is already used")
    created = IngredientCategory(
        id=expected_id,
        name=seed.name,
        created_at=catalog.published_at,
    )
    session.add(created)
    session.flush()
    report.created["ingredient_categories"] += 1
    return created


def _get_or_create_dietary_flag(
    session: Session,
    catalog: SeedCatalog,
    seed: NamedSeed,
    report: SeedReport,
) -> DietaryFlag:
    existing = session.scalars(
        select(DietaryFlag).where(_normalized_match(DietaryFlag.name, seed.name))
    ).one_or_none()
    expected_id = seed_uuid(catalog.metadata.dataset_id, "dietary-flag", seed.key)
    if existing is not None:
        id_owner = session.get(DietaryFlag, expected_id)
        if id_owner is not None and id_owner.id != existing.id:
            raise _conflict("dietary flag", seed.key, "deterministic UUID is already used")
        report.reused["dietary_flags"] += 1
        return existing

    if session.get(DietaryFlag, expected_id) is not None:
        raise _conflict("dietary flag", seed.key, "deterministic UUID is already used")
    created = DietaryFlag(
        id=expected_id,
        name=seed.name,
        created_at=catalog.published_at,
    )
    session.add(created)
    session.flush()
    report.created["dietary_flags"] += 1
    return created


def _get_or_create_allergen(
    session: Session,
    catalog: SeedCatalog,
    seed: NamedSeed,
    report: SeedReport,
) -> Allergen:
    existing = session.scalars(
        select(Allergen).where(_normalized_match(Allergen.name, seed.name))
    ).one_or_none()
    expected_id = seed_uuid(catalog.metadata.dataset_id, "allergen", seed.key)
    if existing is not None:
        id_owner = session.get(Allergen, expected_id)
        if id_owner is not None and id_owner.id != existing.id:
            raise _conflict("allergen", seed.key, "deterministic UUID is already used")
        report.reused["allergens"] += 1
        return existing

    if session.get(Allergen, expected_id) is not None:
        raise _conflict("allergen", seed.key, "deterministic UUID is already used")
    created = Allergen(
        id=expected_id,
        name=seed.name,
        created_at=catalog.published_at,
    )
    session.add(created)
    session.flush()
    report.created["allergens"] += 1
    return created


def _get_or_create_user(
    session: Session,
    report: SeedReport,
    *,
    stable_key: str,
    expected_id: UUID,
    email: str,
    display_name: str,
    account_kind: str,
    created_at: datetime,
) -> User:
    by_id = session.get(User, expected_id)
    conflicting_email_owner = session.scalar(
        select(User).where(User.email == email, User.id != expected_id).limit(1)
    )
    if by_id is not None:
        if (
            by_id.email != email
            or by_id.display_name != display_name
            or by_id.account_kind != account_kind
            or by_id.created_at != created_at
        ):
            raise _conflict("user", stable_key, "deterministic UUID has different content")
        if conflicting_email_owner is not None:
            raise _conflict("user", stable_key, "seed email belongs to another user")
        report.reused["users"] += 1
        return by_id
    if conflicting_email_owner is not None:
        raise _conflict("user", stable_key, "seed email has a non-deterministic UUID")

    created = User(
        id=expected_id,
        email=email,
        display_name=display_name,
        account_kind=account_kind,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(created)
    session.flush()
    report.created["users"] += 1
    return created


def _get_or_create_catalog_user(
    session: Session,
    catalog: SeedCatalog,
    report: SeedReport,
) -> User:
    return _get_or_create_user(
        session,
        report,
        stable_key=CATALOG_USER_KEY,
        expected_id=seed_uuid(catalog.metadata.dataset_id, "user", CATALOG_USER_KEY),
        email=CATALOG_USER_EMAIL,
        display_name=CATALOG_USER_DISPLAY_NAME,
        account_kind=ACCOUNT_KIND_SYSTEM,
        created_at=catalog.published_at,
    )


def _get_or_create_demo_user(
    session: Session,
    report: SeedReport,
) -> User:
    return _get_or_create_user(
        session,
        report,
        stable_key=DEMO_USER_KEY,
        expected_id=DEMO_USER_ID,
        email=DEMO_USER_EMAIL,
        display_name=DEMO_USER_DISPLAY_NAME,
        account_kind=ACCOUNT_KIND_DEMO,
        created_at=DEMO_USER_CREATED_AT,
    )


def _get_or_create_ingredient(
    session: Session,
    catalog: SeedCatalog,
    seed: IngredientSeed,
    categories: dict[str, IngredientCategory],
    dietary_flags: dict[str, DietaryFlag],
    allergens: dict[str, Allergen],
    report: SeedReport,
) -> Ingredient:
    existing = session.scalars(
        select(Ingredient).where(_normalized_match(Ingredient.canonical_name, seed.canonical_name))
    ).one_or_none()
    expected_id = seed_uuid(catalog.metadata.dataset_id, "ingredient", seed.key)
    category_id = categories[seed.category].id if seed.category is not None else None

    if existing is None:
        if session.get(Ingredient, expected_id) is not None:
            raise _conflict("ingredient", seed.key, "deterministic UUID is already used")
        existing = Ingredient(
            id=expected_id,
            canonical_name=seed.canonical_name,
            category_id=category_id,
            created_at=catalog.published_at,
        )
        session.add(existing)
        session.flush()
        report.created["ingredients"] += 1
    else:
        id_owner = session.get(Ingredient, expected_id)
        if id_owner is not None and id_owner.id != existing.id:
            raise _conflict("ingredient", seed.key, "deterministic UUID is already used")
        if category_id is not None:
            if existing.category_id is None:
                existing.category_id = category_id
                report.created["ingredient_category_assignments"] += 1
            elif existing.category_id != category_id:
                raise _conflict("ingredient", seed.key, "category differs from the catalog")
        report.reused["ingredients"] += 1

    current_flag_ids = {flag.id for flag in existing.dietary_flags}
    for flag_key in seed.dietary_flags:
        flag = dietary_flags[flag_key]
        if flag.id not in current_flag_ids:
            existing.dietary_flags.append(flag)
            current_flag_ids.add(flag.id)
            report.created["ingredient_dietary_flags"] += 1
        else:
            report.reused["ingredient_dietary_flags"] += 1

    current_allergen_ids = {allergen.id for allergen in existing.allergens}
    for allergen_key in seed.allergens:
        allergen = allergens[allergen_key]
        if allergen.id not in current_allergen_ids:
            existing.allergens.append(allergen)
            current_allergen_ids.add(allergen.id)
            report.created["ingredient_allergens"] += 1
        else:
            report.reused["ingredient_allergens"] += 1

    session.flush()
    return existing


def _load_aliases(
    session: Session,
    catalog: SeedCatalog,
    seed: IngredientSeed,
    ingredient: Ingredient,
    report: SeedReport,
) -> None:
    for alias_seed in seed.aliases:
        canonical_collision = session.scalars(
            select(Ingredient).where(_normalized_match(Ingredient.canonical_name, alias_seed.name))
        ).one_or_none()
        if canonical_collision is not None and canonical_collision.id != ingredient.id:
            raise _conflict(
                "ingredient alias",
                alias_seed.key,
                "alias collides with another canonical ingredient name",
            )

        existing = session.scalars(
            select(IngredientAlias).where(_normalized_match(IngredientAlias.alias, alias_seed.name))
        ).one_or_none()
        expected_id = seed_uuid(
            catalog.metadata.dataset_id,
            "ingredient-alias",
            f"{seed.key}:{alias_seed.key}",
        )
        if existing is not None:
            id_owner = session.get(IngredientAlias, expected_id)
            if id_owner is not None and id_owner.id != existing.id:
                raise _conflict(
                    "ingredient alias",
                    alias_seed.key,
                    "deterministic UUID is already used",
                )
            if existing.ingredient_id != ingredient.id:
                raise _conflict(
                    "ingredient alias",
                    alias_seed.key,
                    "alias belongs to a different canonical ingredient",
                )
            report.reused["ingredient_aliases"] += 1
            continue

        if session.get(IngredientAlias, expected_id) is not None:
            raise _conflict(
                "ingredient alias",
                alias_seed.key,
                "deterministic UUID is already used",
            )
        session.add(
            IngredientAlias(
                id=expected_id,
                ingredient_id=ingredient.id,
                alias=alias_seed.name,
                created_at=catalog.published_at,
            )
        )
        report.created["ingredient_aliases"] += 1
    session.flush()


def _substitution_values_match(
    existing: IngredientSubstitution,
    seed: SubstitutionSeed,
) -> bool:
    return (
        existing.quantity_ratio == seed.quantity_ratio
        and existing.guidance == seed.guidance
        and existing.notes == seed.notes
        and existing.provenance == seed.provenance
        and existing.confidence == seed.confidence
    )


def _load_substitution(
    session: Session,
    catalog: SeedCatalog,
    seed: SubstitutionSeed,
    ingredients: dict[str, Ingredient],
    report: SeedReport,
) -> None:
    source_id = ingredients[seed.source].id
    replacement_id = ingredients[seed.replacement].id
    stable_key = f"{seed.source}-to-{seed.replacement}"
    expected_id = seed_uuid(catalog.metadata.dataset_id, "ingredient-substitution", stable_key)
    existing = session.scalar(
        select(IngredientSubstitution).where(
            IngredientSubstitution.source_ingredient_id == source_id,
            IngredientSubstitution.replacement_ingredient_id == replacement_id,
        )
    )
    if existing is not None:
        id_owner = session.get(IngredientSubstitution, expected_id)
        if id_owner is not None and id_owner.id != existing.id:
            raise _conflict("ingredient substitution", stable_key, "UUID is already used")
        if not _substitution_values_match(existing, seed):
            raise _conflict(
                "ingredient substitution",
                stable_key,
                "existing explanation differs from the catalog",
            )
        report.reused["ingredient_substitutions"] += 1
        return

    if session.get(IngredientSubstitution, expected_id) is not None:
        raise _conflict("ingredient substitution", stable_key, "UUID is already used")
    session.add(
        IngredientSubstitution(
            id=expected_id,
            source_ingredient_id=source_id,
            replacement_ingredient_id=replacement_id,
            quantity_ratio=seed.quantity_ratio,
            guidance=seed.guidance,
            notes=seed.notes,
            provenance=seed.provenance,
            confidence=seed.confidence,
            created_at=catalog.published_at,
        )
    )
    session.flush()
    report.created["ingredient_substitutions"] += 1


def _get_or_create_lineage(
    session: Session,
    catalog: SeedCatalog,
    root_key: str,
    user: User,
    report: SeedReport,
) -> RecipeLineage:
    lineage_id = seed_uuid(catalog.metadata.dataset_id, "recipe-lineage", root_key)
    existing = session.get(RecipeLineage, lineage_id)
    if existing is not None:
        if existing.created_by_user_id != user.id or existing.created_at != catalog.published_at:
            raise _conflict("recipe lineage", root_key, "stored fields differ from the catalog")
        report.reused["recipe_lineages"] += 1
        return existing

    created = RecipeLineage(
        id=lineage_id,
        created_by_user_id=user.id,
        created_at=catalog.published_at,
    )
    session.add(created)
    session.flush()
    report.created["recipe_lineages"] += 1
    return created


def _recipe_version_values_match(
    existing: RecipeVersion,
    seed: RecipeSeed,
    catalog: SeedCatalog,
    lineage_id: UUID,
    parent_id: UUID | None,
    user_id: UUID,
) -> bool:
    return (
        existing.lineage_id == lineage_id
        and existing.parent_version_id == parent_id
        and existing.created_by_user_id == user_id
        and existing.version_number == seed.version_number
        and existing.title == seed.title
        and existing.description == seed.description
        and existing.servings == seed.servings
        and existing.created_at == catalog.published_at
    )


def _recipe_ingredient_values_match(
    existing: RecipeIngredient,
    seed: RecipeIngredientSeed,
    expected_id: UUID,
    ingredient_id: UUID,
    display_order: int,
) -> bool:
    return (
        existing.id == expected_id
        and existing.ingredient_id == ingredient_id
        and existing.name == seed.name
        and existing.quantity == seed.quantity
        and existing.unit == seed.unit
        and existing.preparation_notes == seed.preparation_notes
        and existing.display_order == display_order
    )


def _recipe_instruction_values_match(
    existing: RecipeInstruction,
    seed: RecipeInstructionSeed,
    expected_id: UUID,
    display_order: int,
) -> bool:
    return (
        existing.id == expected_id
        and existing.instruction == seed.text
        and existing.display_order == display_order
    )


def _verify_recipe_snapshot(
    session: Session,
    catalog: SeedCatalog,
    seed: RecipeSeed,
    version: RecipeVersion,
    ingredients: dict[str, Ingredient],
) -> None:
    existing_ingredients = list(
        session.scalars(
            select(RecipeIngredient)
            .where(RecipeIngredient.recipe_version_id == version.id)
            .order_by(RecipeIngredient.display_order)
        )
    )
    if len(existing_ingredients) != len(seed.ingredients):
        raise _conflict("recipe version", seed.key, "ingredient snapshot differs")

    for display_order, (existing_ingredient, expected_ingredient) in enumerate(
        zip(existing_ingredients, seed.ingredients, strict=True)
    ):
        expected_id = seed_uuid(
            catalog.metadata.dataset_id,
            "recipe-ingredient",
            f"{seed.key}:{expected_ingredient.key}",
        )
        if not _recipe_ingredient_values_match(
            existing_ingredient,
            expected_ingredient,
            expected_id,
            ingredients[expected_ingredient.ingredient].id,
            display_order,
        ):
            raise _conflict("recipe version", seed.key, "ingredient snapshot differs")

    existing_instructions = list(
        session.scalars(
            select(RecipeInstruction)
            .where(RecipeInstruction.recipe_version_id == version.id)
            .order_by(RecipeInstruction.display_order)
        )
    )
    if len(existing_instructions) != len(seed.instructions):
        raise _conflict("recipe version", seed.key, "instruction snapshot differs")

    for display_order, (existing_instruction, expected_instruction) in enumerate(
        zip(existing_instructions, seed.instructions, strict=True)
    ):
        expected_id = seed_uuid(
            catalog.metadata.dataset_id,
            "recipe-instruction",
            f"{seed.key}:{expected_instruction.key}",
        )
        if not _recipe_instruction_values_match(
            existing_instruction,
            expected_instruction,
            expected_id,
            display_order,
        ):
            raise _conflict("recipe version", seed.key, "instruction snapshot differs")


def _insert_recipe_snapshot(
    session: Session,
    catalog: SeedCatalog,
    seed: RecipeSeed,
    version: RecipeVersion,
    ingredients: dict[str, Ingredient],
    report: SeedReport,
) -> None:
    for display_order, item in enumerate(seed.ingredients):
        session.add(
            RecipeIngredient(
                id=seed_uuid(
                    catalog.metadata.dataset_id,
                    "recipe-ingredient",
                    f"{seed.key}:{item.key}",
                ),
                recipe_version_id=version.id,
                ingredient_id=ingredients[item.ingredient].id,
                name=item.name,
                quantity=item.quantity,
                unit=item.unit,
                preparation_notes=item.preparation_notes,
                display_order=display_order,
            )
        )
        report.created["recipe_ingredients"] += 1

    for display_order, instruction in enumerate(seed.instructions):
        session.add(
            RecipeInstruction(
                id=seed_uuid(
                    catalog.metadata.dataset_id,
                    "recipe-instruction",
                    f"{seed.key}:{instruction.key}",
                ),
                recipe_version_id=version.id,
                instruction=instruction.text,
                display_order=display_order,
            )
        )
        report.created["recipe_instructions"] += 1
    session.flush()


def _load_recipe(
    session: Session,
    catalog: SeedCatalog,
    seed: RecipeSeed,
    lineage: RecipeLineage,
    user: User,
    ingredients: dict[str, Ingredient],
    report: SeedReport,
) -> RecipeVersion:
    version_id = seed_uuid(catalog.metadata.dataset_id, "recipe-version", seed.key)
    parent_id = (
        seed_uuid(catalog.metadata.dataset_id, "recipe-version", seed.parent)
        if seed.parent is not None
        else None
    )
    existing = session.get(RecipeVersion, version_id)
    if existing is not None:
        if not _recipe_version_values_match(
            existing,
            seed,
            catalog,
            lineage.id,
            parent_id,
            user.id,
        ):
            raise _conflict("recipe version", seed.key, "stored fields differ from the catalog")
        _verify_recipe_snapshot(session, catalog, seed, existing, ingredients)
        report.reused["recipe_versions"] += 1
        report.reused["recipe_ingredients"] += len(seed.ingredients)
        report.reused["recipe_instructions"] += len(seed.instructions)
        return existing

    created = RecipeVersion(
        id=version_id,
        lineage_id=lineage.id,
        parent_version_id=parent_id,
        created_by_user_id=user.id,
        version_number=seed.version_number,
        title=seed.title,
        description=seed.description,
        servings=seed.servings,
        created_at=catalog.published_at,
    )
    session.add(created)
    session.flush()
    _insert_recipe_snapshot(session, catalog, seed, created, ingredients, report)
    report.created["recipe_versions"] += 1
    return created


def seed_catalog(session: Session, catalog: SeedCatalog) -> SeedReport:
    """Load a validated catalog into the caller's transaction without committing."""

    session.execute(
        text("SELECT pg_advisory_xact_lock(:lock_id)"),
        {"lock_id": SEED_ADVISORY_LOCK_ID},
    )
    report = SeedReport()
    user = _get_or_create_catalog_user(session, catalog, report)
    _get_or_create_demo_user(session, report)
    categories = {
        seed.key: _get_or_create_category(session, catalog, seed, report)
        for seed in catalog.categories
    }
    dietary_flags = {
        seed.key: _get_or_create_dietary_flag(session, catalog, seed, report)
        for seed in catalog.dietary_flags
    }
    allergens = {
        seed.key: _get_or_create_allergen(session, catalog, seed, report)
        for seed in catalog.allergens
    }

    ingredients = {
        seed.key: _get_or_create_ingredient(
            session,
            catalog,
            seed,
            categories,
            dietary_flags,
            allergens,
            report,
        )
        for seed in catalog.ingredients
    }
    for ingredient_seed in catalog.ingredients:
        _load_aliases(
            session,
            catalog,
            ingredient_seed,
            ingredients[ingredient_seed.key],
            report,
        )
    for substitution_seed in catalog.substitutions:
        _load_substitution(session, catalog, substitution_seed, ingredients, report)

    lineages: dict[str, RecipeLineage] = {}
    for recipe_seed in catalog.recipes_in_parent_first_order():
        root_key = catalog.root_key_for(recipe_seed.key)
        if root_key not in lineages:
            lineages[root_key] = _get_or_create_lineage(
                session,
                catalog,
                root_key,
                user,
                report,
            )
        _load_recipe(
            session,
            catalog,
            recipe_seed,
            lineages[root_key],
            user,
            ingredients,
            report,
        )

    session.flush()
    return report
