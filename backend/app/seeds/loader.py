from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import ColumnElement, func, select, text
from sqlalchemy.orm import InstrumentedAttribute, Session, selectinload

from app.catalog_names import lock_catalog_names, normalize_catalog_name
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
    CookingActionType,
    DietaryFlag,
    Ingredient,
    IngredientAlias,
    IngredientCategory,
    IngredientSubstitution,
    MeasurementConversionRule,
    MeasurementUnit,
    MeasurementUnitAlias,
    RecipeCategory,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeLineage,
    RecipeVersion,
    RecipeVersionCategory,
    RecipeVersionPublication,
    User,
)
from app.repositories.recipe_fingerprints import (
    StructuralFingerprintStorageConflictError,
)
from app.seeds.identifiers import action_uuid, measurement_uuid, seed_uuid
from app.seeds.schema import (
    ActionTypeSeed,
    ExactActionMeasureSeed,
    IngredientSeed,
    MeasurementUnitSeed,
    NamedSeed,
    RecipeActionSeed,
    RecipeIngredientSeed,
    RecipeInstructionSeed,
    RecipeSeed,
    SeedCatalog,
    SubstitutionSeed,
)
from app.services.recipe_fingerprint_persistence import (
    fingerprint_and_store_recipe_version,
)

CATALOG_USER_KEY = "catalog-author"
CATALOG_USER_EMAIL = "demo-catalog@recipe-lab.invalid"
CATALOG_USER_DISPLAY_NAME = "Recipe Lab Demo Catalog"
CATALOG_USER_HANDLE = "recipe-lab-catalog"
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


def _ingredients_in_catalog_namespace(session: Session, value: str) -> list[Ingredient]:
    normalized_name = normalize_catalog_name(value)
    return [
        ingredient
        for ingredient in session.scalars(select(Ingredient)).all()
        if normalize_catalog_name(ingredient.canonical_name) == normalized_name
    ]


def _aliases_in_catalog_namespace(session: Session, value: str) -> list[IngredientAlias]:
    normalized_name = normalize_catalog_name(value)
    return [
        alias
        for alias in session.scalars(select(IngredientAlias)).all()
        if normalize_catalog_name(alias.alias) == normalized_name
    ]


def _measurement_unit_values_match(
    existing: MeasurementUnit,
    seed: MeasurementUnitSeed,
    created_at: datetime,
) -> bool:
    return (
        existing.key == seed.key
        and existing.dimension == seed.dimension
        and existing.conversion_family == seed.conversion_family
        and existing.canonical_label == seed.canonical_label
        and existing.plural_label == seed.plural_label
        and existing.symbol == seed.symbol
        and existing.display_style == seed.display_style
        and existing.active is seed.active
        and existing.provenance == seed.provenance
        and existing.created_at == created_at
    )


def _load_measurement_unit(
    session: Session,
    seed: MeasurementUnitSeed,
    created_at: datetime,
    report: SeedReport,
) -> MeasurementUnit:
    expected_id = measurement_uuid("unit", seed.key)
    by_id = session.get(MeasurementUnit, expected_id)
    by_key = session.scalars(
        select(MeasurementUnit).where(_normalized_match(MeasurementUnit.key, seed.key))
    ).one_or_none()
    if by_id is not None:
        if by_key is not None and by_key.id != expected_id:
            raise _conflict("measurement unit", seed.key, "catalog key belongs to another UUID")
        if not _measurement_unit_values_match(by_id, seed, created_at):
            raise _conflict("measurement unit", seed.key, "stored fields differ from the catalog")
        report.reused["measurement_units"] += 1
        return by_id
    if by_key is not None:
        raise _conflict("measurement unit", seed.key, "catalog key has a non-deterministic UUID")

    created = MeasurementUnit(
        id=expected_id,
        key=seed.key,
        dimension=seed.dimension,
        conversion_family=seed.conversion_family,
        canonical_label=seed.canonical_label,
        plural_label=seed.plural_label,
        symbol=seed.symbol,
        display_style=seed.display_style,
        active=seed.active,
        provenance=seed.provenance,
        created_at=created_at,
    )
    session.add(created)
    session.flush()
    report.created["measurement_units"] += 1
    return created


def _load_measurement_aliases(
    session: Session,
    seed: MeasurementUnitSeed,
    unit: MeasurementUnit,
    created_at: datetime,
    report: SeedReport,
) -> None:
    for alias_seed in seed.aliases:
        expected_id = measurement_uuid("unit-alias", f"{seed.key}:{alias_seed.key}")
        by_id = session.get(MeasurementUnitAlias, expected_id)
        by_alias = session.scalars(
            select(MeasurementUnitAlias).where(
                _normalized_match(MeasurementUnitAlias.alias, alias_seed.alias)
            )
        ).one_or_none()
        if by_id is not None:
            if by_alias is not None and by_alias.id != expected_id:
                raise _conflict(
                    "measurement unit alias",
                    f"{seed.key}:{alias_seed.key}",
                    "alias belongs to another UUID",
                )
            if (
                by_id.measurement_unit_id != unit.id
                or by_id.alias != alias_seed.alias
                or by_id.created_at != created_at
            ):
                raise _conflict(
                    "measurement unit alias",
                    f"{seed.key}:{alias_seed.key}",
                    "stored fields differ from the catalog",
                )
            report.reused["measurement_unit_aliases"] += 1
            continue
        if by_alias is not None:
            raise _conflict(
                "measurement unit alias",
                f"{seed.key}:{alias_seed.key}",
                "alias has a non-deterministic UUID",
            )
        session.add(
            MeasurementUnitAlias(
                id=expected_id,
                measurement_unit_id=unit.id,
                alias=alias_seed.alias,
                created_at=created_at,
            )
        )
        session.flush()
        report.created["measurement_unit_aliases"] += 1


def _load_measurement_conversion(
    session: Session,
    seed: MeasurementUnitSeed,
    units: dict[str, MeasurementUnit],
    created_at: datetime,
    report: SeedReport,
) -> None:
    conversion = seed.conversion
    if conversion is None:
        return
    unit = units[seed.key]
    existing = session.get(MeasurementConversionRule, unit.id)
    if existing is not None:
        if not (
            existing.base_unit_id == units[conversion.base_unit].id
            and existing.scale_numerator == conversion.scale_numerator
            and existing.scale_denominator == conversion.scale_denominator
            and existing.offset_numerator == conversion.offset_numerator
            and existing.offset_denominator == conversion.offset_denominator
            and existing.active is seed.active
            and existing.provenance == conversion.provenance
            and existing.created_at == created_at
        ):
            raise _conflict(
                "measurement conversion rule",
                seed.key,
                "stored fields differ from the catalog",
            )
        report.reused["measurement_conversion_rules"] += 1
        return
    session.add(
        MeasurementConversionRule(
            unit_id=unit.id,
            base_unit_id=units[conversion.base_unit].id,
            scale_numerator=conversion.scale_numerator,
            scale_denominator=conversion.scale_denominator,
            offset_numerator=conversion.offset_numerator,
            offset_denominator=conversion.offset_denominator,
            active=seed.active,
            provenance=conversion.provenance,
            created_at=created_at,
        )
    )
    session.flush()
    report.created["measurement_conversion_rules"] += 1


def _load_measurement_catalog(
    session: Session,
    catalog: SeedCatalog,
    report: SeedReport,
) -> dict[str, MeasurementUnit]:
    measurement_catalog = catalog.measurement_catalog
    created_at = measurement_catalog.metadata.published_at
    units = {
        seed.key: _load_measurement_unit(session, seed, created_at, report)
        for seed in measurement_catalog.units
    }
    for seed in measurement_catalog.units:
        _load_measurement_aliases(session, seed, units[seed.key], created_at, report)
    for seed in measurement_catalog.units:
        _load_measurement_conversion(session, seed, units, created_at, report)
    return units


def _action_type_values_match(
    existing: CookingActionType,
    seed: ActionTypeSeed,
    created_at: datetime,
) -> bool:
    return (
        existing.key == seed.key
        and existing.canonical_verb == seed.canonical_verb
        and existing.active is seed.active
        and existing.provenance == seed.provenance
        and existing.created_at == created_at
    )


def _load_action_catalog(
    session: Session,
    catalog: SeedCatalog,
    report: SeedReport,
) -> dict[str, CookingActionType]:
    created_at = catalog.action_catalog.metadata.published_at
    result: dict[str, CookingActionType] = {}
    for seed in catalog.action_catalog.action_types:
        expected_id = action_uuid("action-type", seed.key)
        by_id = session.get(CookingActionType, expected_id)
        by_key = session.scalars(
            select(CookingActionType).where(_normalized_match(CookingActionType.key, seed.key))
        ).one_or_none()
        if by_id is not None:
            if by_key is not None and by_key.id != expected_id:
                raise _conflict(
                    "cooking action type",
                    seed.key,
                    "catalog key belongs to another UUID",
                )
            if not _action_type_values_match(by_id, seed, created_at):
                raise _conflict(
                    "cooking action type",
                    seed.key,
                    "stored fields differ from the catalog",
                )
            report.reused["cooking_action_types"] += 1
            result[seed.key] = by_id
            continue
        if by_key is not None:
            raise _conflict(
                "cooking action type",
                seed.key,
                "catalog key has a non-deterministic UUID",
            )

        created = CookingActionType(
            id=expected_id,
            key=seed.key,
            canonical_verb=seed.canonical_verb,
            active=seed.active,
            provenance=seed.provenance,
            created_at=created_at,
        )
        session.add(created)
        session.flush()
        report.created["cooking_action_types"] += 1
        result[seed.key] = created
    return result


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


def _load_recipe_category_catalog(
    session: Session,
    catalog: SeedCatalog,
    report: SeedReport,
) -> dict[str, RecipeCategory]:
    """Load the fixed discovery vocabulary without deriving recipe assignments."""

    result: dict[str, RecipeCategory] = {}
    created_at = catalog.recipe_category_catalog.metadata.published_at
    for seed in catalog.recipe_category_catalog.categories:
        expected_id = seed_uuid(catalog.metadata.dataset_id, "recipe-category", seed.key)
        by_id = session.get(RecipeCategory, expected_id)
        by_slug = session.scalar(select(RecipeCategory).where(RecipeCategory.slug == seed.slug))
        if by_id is not None:
            if by_slug is not None and by_slug.id != expected_id:
                raise _conflict(
                    "recipe category",
                    seed.key,
                    "catalog slug belongs to another UUID",
                )
            if (
                by_id.name != seed.name
                or by_id.slug != seed.slug
                or by_id.display_order != seed.display_order
                or by_id.active is not seed.active
                or by_id.created_at != created_at
            ):
                raise _conflict(
                    "recipe category",
                    seed.key,
                    "stored fields differ from the catalog",
                )
            report.reused["recipe_categories"] += 1
            result[seed.key] = by_id
            continue
        if by_slug is not None:
            raise _conflict(
                "recipe category",
                seed.key,
                "catalog slug has a non-deterministic UUID",
            )
        created = RecipeCategory(
            id=expected_id,
            name=seed.name,
            slug=seed.slug,
            display_order=seed.display_order,
            active=seed.active,
            created_at=created_at,
        )
        session.add(created)
        session.flush()
        report.created["recipe_categories"] += 1
        result[seed.key] = created
    return result


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
    handle: str | None,
    account_kind: str,
    created_at: datetime,
) -> User:
    by_id = session.get(User, expected_id)
    conflicting_email_owner = session.scalar(
        select(User).where(User.email == email, User.id != expected_id).limit(1)
    )
    conflicting_handle_owner = (
        session.scalar(select(User).where(User.handle == handle, User.id != expected_id).limit(1))
        if handle is not None
        else None
    )
    if by_id is not None:
        if (
            by_id.email != email
            or by_id.display_name != display_name
            or by_id.handle != handle
            or by_id.account_kind != account_kind
            or by_id.created_at != created_at
        ):
            raise _conflict("user", stable_key, "deterministic UUID has different content")
        if conflicting_email_owner is not None:
            raise _conflict("user", stable_key, "seed email belongs to another user")
        if conflicting_handle_owner is not None:
            raise _conflict("user", stable_key, "public handle belongs to another user")
        report.reused["users"] += 1
        return by_id
    if conflicting_email_owner is not None:
        raise _conflict("user", stable_key, "seed email has a non-deterministic UUID")
    if conflicting_handle_owner is not None:
        raise _conflict("user", stable_key, "public handle belongs to another user")

    created = User(
        id=expected_id,
        email=email,
        display_name=display_name,
        handle=handle,
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
        handle=CATALOG_USER_HANDLE,
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
        handle=None,
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
    alias_collisions = _aliases_in_catalog_namespace(session, seed.canonical_name)
    if alias_collisions:
        raise _conflict(
            "ingredient",
            seed.key,
            "canonical name collides with an existing ingredient alias",
        )

    existing = session.scalars(
        select(Ingredient).where(_normalized_match(Ingredient.canonical_name, seed.canonical_name))
    ).one_or_none()
    canonical_candidates = _ingredients_in_catalog_namespace(session, seed.canonical_name)
    conflicting_candidates = [
        candidate
        for candidate in canonical_candidates
        if existing is None or candidate.id != existing.id
    ]
    if conflicting_candidates:
        raise _conflict(
            "ingredient",
            seed.key,
            "canonical name has a normalized catalog candidate that cannot establish identity",
        )
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
        canonical_collisions = _ingredients_in_catalog_namespace(session, alias_seed.name)
        if canonical_collisions:
            raise _conflict(
                "ingredient alias",
                alias_seed.key,
                "alias collides with a canonical ingredient name",
            )

        existing = session.scalars(
            select(IngredientAlias).where(_normalized_match(IngredientAlias.alias, alias_seed.name))
        ).one_or_none()
        alias_candidates = _aliases_in_catalog_namespace(session, alias_seed.name)
        conflicting_candidates = [
            candidate
            for candidate in alias_candidates
            if existing is None or candidate.id != existing.id
        ]
        if conflicting_candidates:
            raise _conflict(
                "ingredient alias",
                alias_seed.key,
                "alias has a normalized catalog candidate that cannot establish identity",
            )
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
    measurement_unit_id: UUID | None,
    display_order: int,
) -> bool:
    return (
        existing.id == expected_id
        and existing.ingredient_id == ingredient_id
        and existing.name == seed.name
        and existing.measure_mode == ("exact" if seed.quantity is not None else "unspecified")
        and existing.quantity_min == seed.quantity
        and existing.quantity_max is None
        and existing.measurement_unit_id == measurement_unit_id
        and existing.unit_display == seed.unit
        and existing.package_size_id is None
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


def _seed_action_measure_fields(
    seed: RecipeActionSeed,
    semantic: str,
    measurement_units: dict[str, MeasurementUnit],
) -> tuple[str, Decimal, Decimal | None, UUID, str] | None:
    measure = seed.duration if semantic == "duration" else seed.temperature
    if measure is None:
        return None
    unit = measurement_units[measure.unit]
    unit_display = unit.symbol or unit.canonical_label
    if isinstance(measure, ExactActionMeasureSeed):
        return "exact", measure.value, None, unit.id, unit_display
    return "range", measure.minimum, measure.maximum, unit.id, unit_display


def _verify_recipe_instruction_actions(
    session: Session,
    catalog: SeedCatalog,
    recipe: RecipeSeed,
    instruction_seed: RecipeInstructionSeed,
    instruction: RecipeInstruction,
    action_types: dict[str, CookingActionType],
    measurement_units: dict[str, MeasurementUnit],
) -> None:
    existing_actions = list(
        session.scalars(
            select(RecipeInstructionAction)
            .options(
                selectinload(RecipeInstructionAction.inputs),
                selectinload(RecipeInstructionAction.measures),
            )
            .where(RecipeInstructionAction.recipe_instruction_id == instruction.id)
            .order_by(RecipeInstructionAction.display_order)
        )
    )
    if len(existing_actions) != len(instruction_seed.actions):
        raise _conflict("recipe version", recipe.key, "instruction actions differ")

    ingredient_seed_by_key = {item.key: item for item in recipe.ingredients}
    for action_order, (existing_action, action_seed) in enumerate(
        zip(existing_actions, instruction_seed.actions, strict=True)
    ):
        stable_action_key = f"{recipe.key}:{instruction_seed.key}:{action_seed.key}"
        expected_action_id = seed_uuid(
            catalog.metadata.dataset_id,
            "recipe-instruction-action",
            stable_action_key,
        )
        if not (
            existing_action.id == expected_action_id
            and existing_action.recipe_version_id == instruction.recipe_version_id
            and existing_action.recipe_instruction_id == instruction.id
            and existing_action.action_type_id == action_types[action_seed.action_type].id
            and existing_action.display_order == action_order
        ):
            raise _conflict("recipe version", recipe.key, "instruction actions differ")

        if len(existing_action.inputs) != len(action_seed.inputs):
            raise _conflict("recipe version", recipe.key, "instruction action inputs differ")
        for input_order, (existing_input, input_key) in enumerate(
            zip(existing_action.inputs, action_seed.inputs, strict=True)
        ):
            expected_input_id = seed_uuid(
                catalog.metadata.dataset_id,
                "recipe-instruction-action-input",
                f"{stable_action_key}:{input_key}",
            )
            expected_ingredient_id = seed_uuid(
                catalog.metadata.dataset_id,
                "recipe-ingredient",
                f"{recipe.key}:{ingredient_seed_by_key[input_key].key}",
            )
            if not (
                existing_input.id == expected_input_id
                and existing_input.recipe_version_id == instruction.recipe_version_id
                and existing_input.recipe_instruction_action_id == expected_action_id
                and existing_input.recipe_ingredient_id == expected_ingredient_id
                and existing_input.display_order == input_order
            ):
                raise _conflict(
                    "recipe version",
                    recipe.key,
                    "instruction action inputs differ",
                )

        measures_by_semantic = {measure.semantic: measure for measure in existing_action.measures}
        expected_semantics = {
            semantic
            for semantic, measure in (
                ("duration", action_seed.duration),
                ("temperature", action_seed.temperature),
            )
            if measure is not None
        }
        if set(measures_by_semantic) != expected_semantics:
            raise _conflict("recipe version", recipe.key, "instruction action measures differ")
        for semantic in sorted(expected_semantics):
            expected_fields = _seed_action_measure_fields(
                action_seed,
                semantic,
                measurement_units,
            )
            if expected_fields is None:
                raise AssertionError("Expected action measure fields were not produced.")
            existing_measure = measures_by_semantic[semantic]
            if (
                existing_measure.measure_mode,
                existing_measure.quantity_min,
                existing_measure.quantity_max,
                existing_measure.measurement_unit_id,
                existing_measure.unit_display,
            ) != expected_fields:
                raise _conflict(
                    "recipe version",
                    recipe.key,
                    "instruction action measures differ",
                )


def _insert_recipe_instruction_actions(
    session: Session,
    catalog: SeedCatalog,
    recipe: RecipeSeed,
    instruction_seed: RecipeInstructionSeed,
    instruction_id: UUID,
    recipe_version_id: UUID,
    action_types: dict[str, CookingActionType],
    measurement_units: dict[str, MeasurementUnit],
    report: SeedReport,
) -> None:
    for action_order, action_seed in enumerate(instruction_seed.actions):
        stable_action_key = f"{recipe.key}:{instruction_seed.key}:{action_seed.key}"
        action_id = seed_uuid(
            catalog.metadata.dataset_id,
            "recipe-instruction-action",
            stable_action_key,
        )
        session.add(
            RecipeInstructionAction(
                id=action_id,
                recipe_version_id=recipe_version_id,
                recipe_instruction_id=instruction_id,
                action_type_id=action_types[action_seed.action_type].id,
                display_order=action_order,
            )
        )
        report.created["recipe_instruction_actions"] += 1
        for input_order, input_key in enumerate(action_seed.inputs):
            session.add(
                RecipeInstructionActionInput(
                    id=seed_uuid(
                        catalog.metadata.dataset_id,
                        "recipe-instruction-action-input",
                        f"{stable_action_key}:{input_key}",
                    ),
                    recipe_version_id=recipe_version_id,
                    recipe_instruction_action_id=action_id,
                    recipe_ingredient_id=seed_uuid(
                        catalog.metadata.dataset_id,
                        "recipe-ingredient",
                        f"{recipe.key}:{input_key}",
                    ),
                    display_order=input_order,
                )
            )
            report.created["recipe_instruction_action_inputs"] += 1
        for semantic in ("duration", "temperature"):
            fields = _seed_action_measure_fields(action_seed, semantic, measurement_units)
            if fields is None:
                continue
            measure_mode, quantity_min, quantity_max, unit_id, unit_display = fields
            session.add(
                RecipeInstructionActionMeasure(
                    recipe_instruction_action_id=action_id,
                    semantic=semantic,
                    measure_mode=measure_mode,
                    quantity_min=quantity_min,
                    quantity_max=quantity_max,
                    measurement_unit_id=unit_id,
                    unit_display=unit_display,
                )
            )
            report.created["recipe_instruction_action_measures"] += 1


def _verify_recipe_snapshot(
    session: Session,
    catalog: SeedCatalog,
    seed: RecipeSeed,
    version: RecipeVersion,
    ingredients: dict[str, Ingredient],
    measurement_units: dict[str, MeasurementUnit],
    action_types: dict[str, CookingActionType],
    recipe_categories: dict[str, RecipeCategory],
) -> None:
    existing_categories = list(
        session.scalars(
            select(RecipeVersionCategory)
            .where(RecipeVersionCategory.recipe_version_id == version.id)
            .order_by(RecipeVersionCategory.display_order)
        )
    )
    if len(existing_categories) != len(seed.categories):
        raise _conflict("recipe version", seed.key, "category snapshot differs")
    for display_order, (existing_category, category_key) in enumerate(
        zip(existing_categories, seed.categories, strict=True)
    ):
        expected = recipe_categories[category_key]
        if (
            existing_category.recipe_category_id != expected.id
            or existing_category.category_name != expected.name
            or existing_category.category_slug != expected.slug
            or existing_category.display_order != display_order
        ):
            raise _conflict("recipe version", seed.key, "category snapshot differs")

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
            (
                measurement_units[expected_ingredient.unit].id
                if expected_ingredient.unit is not None
                else None
            ),
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
        _verify_recipe_instruction_actions(
            session,
            catalog,
            seed,
            expected_instruction,
            existing_instruction,
            action_types,
            measurement_units,
        )


def _insert_recipe_snapshot(
    session: Session,
    catalog: SeedCatalog,
    seed: RecipeSeed,
    version: RecipeVersion,
    ingredients: dict[str, Ingredient],
    measurement_units: dict[str, MeasurementUnit],
    action_types: dict[str, CookingActionType],
    recipe_categories: dict[str, RecipeCategory],
    report: SeedReport,
) -> None:
    session.add_all(
        [
            RecipeVersionCategory(
                recipe_version_id=version.id,
                recipe_category_id=recipe_categories[category_key].id,
                category_name=recipe_categories[category_key].name,
                category_slug=recipe_categories[category_key].slug,
                display_order=display_order,
            )
            for display_order, category_key in enumerate(seed.categories)
        ]
    )
    report.created["recipe_version_categories"] += len(seed.categories)

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
                measure_mode="exact" if item.quantity is not None else "unspecified",
                quantity_min=item.quantity,
                quantity_max=None,
                measurement_unit_id=(
                    measurement_units[item.unit].id if item.unit is not None else None
                ),
                unit_display=item.unit,
                package_size_id=None,
                preparation_notes=item.preparation_notes,
                display_order=display_order,
            )
        )
        report.created["recipe_ingredients"] += 1

    for display_order, instruction in enumerate(seed.instructions):
        instruction_id = seed_uuid(
            catalog.metadata.dataset_id,
            "recipe-instruction",
            f"{seed.key}:{instruction.key}",
        )
        session.add(
            RecipeInstruction(
                id=instruction_id,
                recipe_version_id=version.id,
                instruction=instruction.text,
                display_order=display_order,
            )
        )
        report.created["recipe_instructions"] += 1
        _insert_recipe_instruction_actions(
            session,
            catalog,
            seed,
            instruction,
            instruction_id,
            version.id,
            action_types,
            measurement_units,
            report,
        )
    session.flush()


def _load_recipe(
    session: Session,
    catalog: SeedCatalog,
    seed: RecipeSeed,
    lineage: RecipeLineage,
    user: User,
    ingredients: dict[str, Ingredient],
    measurement_units: dict[str, MeasurementUnit],
    action_types: dict[str, CookingActionType],
    recipe_categories: dict[str, RecipeCategory],
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
        _verify_recipe_snapshot(
            session,
            catalog,
            seed,
            existing,
            ingredients,
            measurement_units,
            action_types,
            recipe_categories,
        )
        report.reused["recipe_versions"] += 1
        report.reused["recipe_ingredients"] += len(seed.ingredients)
        report.reused["recipe_instructions"] += len(seed.instructions)
        report.reused["recipe_instruction_actions"] += sum(
            len(instruction.actions) for instruction in seed.instructions
        )
        report.reused["recipe_instruction_action_inputs"] += sum(
            len(action.inputs)
            for instruction in seed.instructions
            for action in instruction.actions
        )
        report.reused["recipe_instruction_action_measures"] += sum(
            int(action.duration is not None) + int(action.temperature is not None)
            for instruction in seed.instructions
            for action in instruction.actions
        )
        report.reused["recipe_version_categories"] += len(seed.categories)
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
    _insert_recipe_snapshot(
        session,
        catalog,
        seed,
        created,
        ingredients,
        measurement_units,
        action_types,
        recipe_categories,
        report,
    )
    report.created["recipe_versions"] += 1
    return created


def _record_recipe_structural_fingerprint(
    session: Session,
    *,
    seed: RecipeSeed,
    version: RecipeVersion,
    report: SeedReport,
) -> None:
    """Persist one exact identity alongside the deterministic seed snapshot."""

    try:
        result = fingerprint_and_store_recipe_version(session, version.id)
    except StructuralFingerprintStorageConflictError as error:
        raise _conflict(
            "recipe structural fingerprint",
            seed.key,
            str(error),
        ) from error
    if result.state == "incomplete":
        raise _conflict(
            "recipe structural fingerprint",
            seed.key,
            "the reviewed seed snapshot did not produce an exact identity",
        )
    entity = "recipe_structural_fingerprints"
    if result.state == "created":
        report.created[entity] += 1
    else:
        report.reused[entity] += 1


def _record_recipe_publication(
    session: Session,
    *,
    seed: RecipeSeed,
    version: RecipeVersion,
    catalog: SeedCatalog,
    report: SeedReport,
) -> None:
    """Make deterministic seed snapshots publicly visible under the new predicate."""

    existing = session.get(RecipeVersionPublication, version.id)
    if existing is not None:
        if (
            existing.actor_user_id != version.created_by_user_id
            or existing.source_draft_id is not None
            or existing.action_id is not None
            or existing.request_fingerprint is not None
            or existing.draft_revision is not None
            or existing.duplicate_preflight_id is not None
            or existing.duplicate_policy_version is not None
            or existing.duplicate_result_digest is not None
            or existing.duplicate_decision_id is not None
            or existing.published_at != catalog.published_at
        ):
            raise _conflict(
                "recipe version publication",
                seed.key,
                "stored publication evidence differs from the catalog",
            )
        report.reused["recipe_version_publications"] += 1
        return

    session.add(
        RecipeVersionPublication(
            recipe_version_id=version.id,
            state="published",
            actor_user_id=version.created_by_user_id,
            state_changed_at=catalog.published_at,
            state_changed_by_user_id=version.created_by_user_id,
            published_at=catalog.published_at,
        )
    )
    session.flush()
    report.created["recipe_version_publications"] += 1


def seed_catalog(session: Session, catalog: SeedCatalog) -> SeedReport:
    """Load a validated catalog into the caller's transaction without committing."""

    session.execute(
        text("SELECT pg_advisory_xact_lock(:lock_id)"),
        {"lock_id": SEED_ADVISORY_LOCK_ID},
    )
    lock_catalog_names(
        session,
        {
            normalize_catalog_name(name)
            for ingredient in catalog.ingredients
            for name in [
                ingredient.canonical_name,
                *(alias.name for alias in ingredient.aliases),
            ]
        },
    )
    report = SeedReport()
    measurement_units = _load_measurement_catalog(session, catalog, report)
    action_types = _load_action_catalog(session, catalog, report)
    recipe_categories = _load_recipe_category_catalog(session, catalog, report)
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
        version = _load_recipe(
            session,
            catalog,
            recipe_seed,
            lineages[root_key],
            user,
            ingredients,
            measurement_units,
            action_types,
            recipe_categories,
            report,
        )
        _record_recipe_structural_fingerprint(
            session,
            seed=recipe_seed,
            version=version,
            report=report,
        )
        _record_recipe_publication(
            session,
            seed=recipe_seed,
            version=version,
            catalog=catalog,
            report=report,
        )

    session.flush()
    return report
