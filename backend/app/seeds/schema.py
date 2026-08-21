from datetime import datetime
from decimal import Decimal
from typing import Annotated, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

NonBlank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
SeedKey = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]
PositiveServings = Annotated[
    Decimal,
    Field(gt=0, max_digits=8, decimal_places=2),
]
PositiveQuantity = Annotated[
    Decimal,
    Field(gt=0, max_digits=12, decimal_places=4),
]
Confidence = Annotated[
    Decimal,
    Field(ge=0, le=1, max_digits=5, decimal_places=4),
]


def normalize_name(value: str) -> str:
    """Mirror the catalog's PostgreSQL lower/btrim lookup convention."""

    return value.strip().lower()


class SeedModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CatalogMetadata(SeedModel):
    dataset_id: SeedKey
    version: Annotated[int, Field(ge=1)]
    title: NonBlank
    source: NonBlank
    provenance: NonBlank
    license: NonBlank
    license_url: NonBlank
    published_at: AwareDatetime


class NamedSeed(SeedModel):
    key: SeedKey
    name: NonBlank


class IngredientSeed(SeedModel):
    key: SeedKey
    canonical_name: NonBlank
    category: SeedKey | None = None
    aliases: list[NamedSeed] = Field(default_factory=list)
    dietary_flags: list[SeedKey] = Field(default_factory=list)
    allergens: list[SeedKey] = Field(default_factory=list)


class SubstitutionSeed(SeedModel):
    source: SeedKey
    replacement: SeedKey
    quantity_ratio: PositiveQuantity | None = None
    guidance: NonBlank | None = None
    notes: NonBlank | None = None
    provenance: NonBlank | None = None
    confidence: Confidence | None = None


class RecipeIngredientSeed(SeedModel):
    key: SeedKey
    ingredient: SeedKey
    name: NonBlank
    quantity: PositiveQuantity | None = None
    unit: NonBlank | None = None
    preparation_notes: NonBlank | None = None


class RecipeInstructionSeed(SeedModel):
    key: SeedKey
    text: NonBlank


class RecipeSeed(SeedModel):
    key: SeedKey
    parent: SeedKey | None = None
    version_number: Annotated[int, Field(ge=1)]
    title: NonBlank
    description: NonBlank | None = None
    servings: PositiveServings
    ingredients: Annotated[list[RecipeIngredientSeed], Field(min_length=1)]
    instructions: Annotated[list[RecipeInstructionSeed], Field(min_length=1)]


class SeedCatalog(SeedModel):
    metadata: CatalogMetadata
    categories: list[NamedSeed]
    dietary_flags: list[NamedSeed]
    allergens: list[NamedSeed]
    ingredients: Annotated[list[IngredientSeed], Field(min_length=1)]
    substitutions: list[SubstitutionSeed]
    recipes: Annotated[list[RecipeSeed], Field(min_length=1)]

    def _require_unique_keys(self, records: list[NamedSeed], label: str) -> None:
        keys = [record.key for record in records]
        if len(keys) != len(set(keys)):
            raise ValueError(f"{label} keys must be unique")

        normalized_names = [normalize_name(record.name) for record in records]
        if len(normalized_names) != len(set(normalized_names)):
            raise ValueError(f"{label} names must be unique after normalization")

    def _recipe_root(
        self,
        recipe_key: str,
        recipes_by_key: dict[str, RecipeSeed],
        active_path: set[str],
    ) -> str:
        if recipe_key in active_path:
            raise ValueError(f"recipe parent cycle includes {recipe_key!r}")

        recipe = recipes_by_key[recipe_key]
        if recipe.parent is None:
            return recipe.key

        return self._recipe_root(
            recipe.parent,
            recipes_by_key,
            active_path | {recipe_key},
        )

    def _validate_ingredient_names(self, ingredients_by_key: dict[str, IngredientSeed]) -> None:
        valid_names_by_key = {
            ingredient.key: {
                normalize_name(ingredient.canonical_name),
                *(normalize_name(alias.name) for alias in ingredient.aliases),
            }
            for ingredient in self.ingredients
        }
        for recipe in self.recipes:
            ingredient_row_keys = [item.key for item in recipe.ingredients]
            if len(ingredient_row_keys) != len(set(ingredient_row_keys)):
                raise ValueError(f"recipe {recipe.key!r} ingredient row keys must be unique")
            instruction_keys = [instruction.key for instruction in recipe.instructions]
            if len(instruction_keys) != len(set(instruction_keys)):
                raise ValueError(f"recipe {recipe.key!r} instruction keys must be unique")
            for recipe_ingredient in recipe.ingredients:
                if recipe_ingredient.ingredient not in ingredients_by_key:
                    raise ValueError(
                        f"recipe {recipe.key!r} references unknown ingredient "
                        f"{recipe_ingredient.ingredient!r}"
                    )
                if (
                    normalize_name(recipe_ingredient.name)
                    not in valid_names_by_key[recipe_ingredient.ingredient]
                ):
                    raise ValueError(
                        f"recipe {recipe.key!r} display name {recipe_ingredient.name!r} "
                        f"is not a canonical name or alias for "
                        f"{recipe_ingredient.ingredient!r}"
                    )

    def _validate_recipe_graph(self) -> None:
        recipes_by_key = {recipe.key: recipe for recipe in self.recipes}
        if len(recipes_by_key) != len(self.recipes):
            raise ValueError("recipe keys must be unique")

        for recipe in self.recipes:
            if recipe.parent is not None and recipe.parent not in recipes_by_key:
                raise ValueError(
                    f"recipe {recipe.key!r} references unknown parent {recipe.parent!r}"
                )
            if recipe.parent is None and recipe.version_number != 1:
                raise ValueError(f"root recipe {recipe.key!r} must use version number 1")
            if recipe.parent is not None:
                parent = recipes_by_key[recipe.parent]
                if recipe.version_number <= parent.version_number:
                    raise ValueError(
                        f"recipe {recipe.key!r} must have a version number greater than its parent"
                    )

        version_numbers_by_root: dict[str, set[int]] = {}
        for recipe in self.recipes:
            root = self._recipe_root(recipe.key, recipes_by_key, set())
            lineage_numbers = version_numbers_by_root.setdefault(root, set())
            if recipe.version_number in lineage_numbers:
                raise ValueError(f"lineage {root!r} repeats version number {recipe.version_number}")
            lineage_numbers.add(recipe.version_number)

    def _validate_substitutions(self, ingredients_by_key: dict[str, IngredientSeed]) -> None:
        pairs: set[tuple[str, str]] = set()
        for substitution in self.substitutions:
            if substitution.source not in ingredients_by_key:
                raise ValueError(f"substitution references unknown source {substitution.source!r}")
            if substitution.replacement not in ingredients_by_key:
                raise ValueError(
                    f"substitution references unknown replacement {substitution.replacement!r}"
                )
            if substitution.source == substitution.replacement:
                raise ValueError("substitution source and replacement must differ")
            if substitution.quantity_ratio is None and substitution.guidance is None:
                raise ValueError("substitution requires a quantity ratio or guidance")
            if substitution.provenance is None and substitution.confidence is None:
                raise ValueError("substitution requires provenance or confidence")

            pair = (substitution.source, substitution.replacement)
            if pair in pairs:
                raise ValueError(f"duplicate directed substitution {pair!r}")
            pairs.add(pair)

    def _validate_name_namespaces(self) -> None:
        canonical_names: dict[str, str] = {}
        alias_names: dict[str, str] = {}
        for ingredient in self.ingredients:
            normalized_canonical = normalize_name(ingredient.canonical_name)
            if normalized_canonical in canonical_names:
                raise ValueError("canonical ingredient names must be unique")
            canonical_names[normalized_canonical] = ingredient.key

            alias_keys = [alias.key for alias in ingredient.aliases]
            if len(alias_keys) != len(set(alias_keys)):
                raise ValueError(f"ingredient {ingredient.key!r} alias keys must be unique")
            for alias in ingredient.aliases:
                normalized_alias = normalize_name(alias.name)
                if normalized_alias in alias_names:
                    raise ValueError("ingredient aliases must be globally unique")
                alias_names[normalized_alias] = ingredient.key

        collisions = set(canonical_names) & set(alias_names)
        if collisions:
            collision = min(collisions)
            raise ValueError(
                f"canonical ingredient names and aliases must not collide: {collision!r}"
            )

    def _validate_metadata_references(self) -> None:
        category_keys = {category.key for category in self.categories}
        dietary_flag_keys = {flag.key for flag in self.dietary_flags}
        allergen_keys = {allergen.key for allergen in self.allergens}
        for ingredient in self.ingredients:
            if ingredient.category is not None and ingredient.category not in category_keys:
                raise ValueError(
                    f"ingredient {ingredient.key!r} references unknown category "
                    f"{ingredient.category!r}"
                )
            if len(ingredient.dietary_flags) != len(set(ingredient.dietary_flags)):
                raise ValueError(f"ingredient {ingredient.key!r} repeats a dietary flag")
            if len(ingredient.allergens) != len(set(ingredient.allergens)):
                raise ValueError(f"ingredient {ingredient.key!r} repeats an allergen")
            unknown_flags = set(ingredient.dietary_flags) - dietary_flag_keys
            if unknown_flags:
                raise ValueError(
                    f"ingredient {ingredient.key!r} references unknown dietary flags "
                    f"{sorted(unknown_flags)!r}"
                )
            unknown_allergens = set(ingredient.allergens) - allergen_keys
            if unknown_allergens:
                raise ValueError(
                    f"ingredient {ingredient.key!r} references unknown allergens "
                    f"{sorted(unknown_allergens)!r}"
                )

    @property
    def published_at(self) -> datetime:
        return self.metadata.published_at

    def recipes_in_parent_first_order(self) -> list[RecipeSeed]:
        recipes_by_key = {recipe.key: recipe for recipe in self.recipes}
        ordered: list[RecipeSeed] = []
        visited: set[str] = set()

        def visit(recipe: RecipeSeed) -> None:
            if recipe.key in visited:
                return
            if recipe.parent is not None:
                visit(recipes_by_key[recipe.parent])
            visited.add(recipe.key)
            ordered.append(recipe)

        for catalog_recipe in self.recipes:
            visit(catalog_recipe)
        return ordered

    def root_key_for(self, recipe_key: str) -> str:
        recipes_by_key = {recipe.key: recipe for recipe in self.recipes}
        return self._recipe_root(recipe_key, recipes_by_key, set())

    @model_validator(mode="after")
    def validate_catalog(self) -> Self:
        """Validate references and invariants that span multiple records."""

        self._require_unique_keys(self.categories, "category")
        self._require_unique_keys(self.dietary_flags, "dietary flag")
        self._require_unique_keys(self.allergens, "allergen")
        ingredients_by_key = {ingredient.key: ingredient for ingredient in self.ingredients}
        if len(ingredients_by_key) != len(self.ingredients):
            raise ValueError("ingredient keys must be unique")

        self._validate_name_namespaces()
        self._validate_metadata_references()
        self._validate_ingredient_names(ingredients_by_key)
        self._validate_substitutions(ingredients_by_key)
        self._validate_recipe_graph()
        return self
