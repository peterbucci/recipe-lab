from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Callable, Hashable, Iterable, Sequence
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from app.models import RecipeIngredient, RecipeInstruction, RecipeVersion
from app.schemas.recipe_diffs import (
    RecipeDiffResponse,
    RecipeFieldChange,
    RecipeFieldName,
    RecipeFieldValue,
    RecipeIngredientChangedField,
    RecipeIngredientDiff,
    RecipeIngredientPairChange,
    RecipeInstructionDiff,
    RecipeInstructionPairChange,
)
from app.schemas.recipes import (
    RecipeIngredientResponse,
    RecipeInstructionResponse,
    RecipeVersionReference,
)


class _Identified(Protocol):
    id: UUID


_INGREDIENT_FIELD_ORDER: tuple[RecipeIngredientChangedField, ...] = (
    "ingredient",
    "display_name",
    "quantity",
    "unit",
    "preparation_notes",
)


def _ingredient_order(item: RecipeIngredient) -> tuple[int, int]:
    return item.display_order, item.id.int


def _instruction_order(item: RecipeInstruction) -> tuple[int, int]:
    return item.display_order, item.id.int


def _ingredient_signature(
    item: RecipeIngredient,
) -> tuple[str, Decimal | None, str | None, str | None]:
    return item.name, item.quantity, item.unit, item.preparation_notes


def _replacement_candidate_order(
    before: RecipeIngredient,
    after: RecipeIngredient,
) -> tuple[int, bool, bool, bool, int, int, int]:
    """Prefer replacements that preserve amount semantics before row position."""

    content_changes = (
        before.quantity != after.quantity,
        before.unit != after.unit,
        before.preparation_notes != after.preparation_notes,
    )
    return (
        sum(content_changes),
        *content_changes,
        abs(before.display_order - after.display_order),
        *_ingredient_order(after),
    )


def _pair_exact_occurrences[Item: _Identified, Signature: Hashable](
    before_items: list[Item],
    after_items: list[Item],
    *,
    signature: Callable[[Item], Signature],
) -> tuple[list[tuple[Item, Item]], list[Item], list[Item]]:
    """Pair equal duplicate occurrences without depending on collection order."""

    after_by_signature: dict[Signature, deque[Item]] = defaultdict(deque)
    for item in after_items:
        after_by_signature[signature(item)].append(item)

    pairs: list[tuple[Item, Item]] = []
    remaining_before: list[Item] = []
    matched_after_ids: set[UUID] = set()
    for item in before_items:
        candidates = after_by_signature.get(signature(item))
        if not candidates:
            remaining_before.append(item)
            continue
        matched = candidates.popleft()
        pairs.append((item, matched))
        matched_after_ids.add(matched.id)

    remaining_after = [item for item in after_items if item.id not in matched_after_ids]
    return pairs, remaining_before, remaining_after


def _pair_same_ingredients(
    before_items: list[RecipeIngredient],
    after_items: list[RecipeIngredient],
) -> tuple[
    list[tuple[RecipeIngredient, RecipeIngredient]],
    list[RecipeIngredient],
    list[RecipeIngredient],
]:
    before_by_ingredient: dict[UUID, list[RecipeIngredient]] = defaultdict(list)
    after_by_ingredient: dict[UUID, list[RecipeIngredient]] = defaultdict(list)
    for item in before_items:
        before_by_ingredient[item.ingredient_id].append(item)
    for item in after_items:
        after_by_ingredient[item.ingredient_id].append(item)

    pairs: list[tuple[RecipeIngredient, RecipeIngredient]] = []
    unmatched_before: list[RecipeIngredient] = []
    unmatched_after: list[RecipeIngredient] = []
    ingredient_ids = sorted(
        before_by_ingredient.keys() | after_by_ingredient.keys(),
        key=lambda value: value.int,
    )
    for ingredient_id in ingredient_ids:
        before_group = sorted(before_by_ingredient[ingredient_id], key=_ingredient_order)
        after_group = sorted(after_by_ingredient[ingredient_id], key=_ingredient_order)
        exact, remaining_before, remaining_after = _pair_exact_occurrences(
            before_group,
            after_group,
            signature=_ingredient_signature,
        )
        pairs.extend(exact)

        shared_count = min(len(remaining_before), len(remaining_after))
        pairs.extend(
            zip(
                remaining_before[:shared_count],
                remaining_after[:shared_count],
                strict=True,
            )
        )
        unmatched_before.extend(remaining_before[shared_count:])
        unmatched_after.extend(remaining_after[shared_count:])

    return pairs, unmatched_before, unmatched_after


def _pair_direct_substitutions(
    before_items: list[RecipeIngredient],
    after_items: list[RecipeIngredient],
    substitution_pairs: set[tuple[UUID, UUID]],
) -> tuple[
    list[tuple[RecipeIngredient, RecipeIngredient]],
    list[RecipeIngredient],
    list[RecipeIngredient],
]:
    """Find a deterministic maximum matching over directed substitution edges."""

    ordered_before = sorted(before_items, key=_ingredient_order)
    ordered_after = sorted(after_items, key=_ingredient_order)
    candidates: dict[UUID, list[RecipeIngredient]] = {
        before.id: sorted(
            (
                after
                for after in ordered_after
                if (before.ingredient_id, after.ingredient_id) in substitution_pairs
            ),
            key=lambda after: _replacement_candidate_order(before, after),
        )
        for before in ordered_before
    }
    before_by_id = {item.id: item for item in ordered_before}
    matched_before_by_after: dict[UUID, UUID] = {}

    def assign(before_id: UUID, visited_after: set[UUID]) -> bool:
        for after in candidates[before_id]:
            if after.id in visited_after:
                continue
            visited_after.add(after.id)
            prior_before_id = matched_before_by_after.get(after.id)
            if prior_before_id is None or assign(prior_before_id, visited_after):
                matched_before_by_after[after.id] = before_id
                return True
        return False

    for before in ordered_before:
        assign(before.id, set())

    after_by_id = {item.id: item for item in ordered_after}
    pairs = sorted(
        (
            (before_by_id[before_id], after_by_id[after_id])
            for after_id, before_id in matched_before_by_after.items()
        ),
        key=lambda pair: (*_ingredient_order(pair[0]), *_ingredient_order(pair[1])),
    )
    matched_before_ids = {before.id for before, _after in pairs}
    matched_after_ids = {after.id for _before, after in pairs}
    return (
        pairs,
        [item for item in ordered_before if item.id not in matched_before_ids],
        [item for item in ordered_after if item.id not in matched_after_ids],
    )


def _ingredient_snapshot(item: RecipeIngredient) -> RecipeIngredientResponse:
    return RecipeIngredientResponse(
        id=item.id,
        ingredient_id=item.ingredient_id,
        canonical_name=item.ingredient.canonical_name,
        display_name=item.name,
        quantity=item.quantity,
        unit=item.unit,
        preparation_notes=item.preparation_notes,
        display_order=item.display_order,
    )


def _instruction_snapshot(item: RecipeInstruction) -> RecipeInstructionResponse:
    return RecipeInstructionResponse(
        id=item.id,
        text=item.instruction,
        display_order=item.display_order,
    )


def _ingredient_changed_fields(
    before: RecipeIngredient,
    after: RecipeIngredient,
) -> list[RecipeIngredientChangedField]:
    changed = {
        "ingredient": before.ingredient_id != after.ingredient_id,
        "display_name": before.name != after.name,
        "quantity": before.quantity != after.quantity,
        "unit": before.unit != after.unit,
        "preparation_notes": before.preparation_notes != after.preparation_notes,
    }
    return [field for field in _INGREDIENT_FIELD_ORDER if changed[field]]


def _metadata_changes(
    base: RecipeVersion,
    target: RecipeVersion,
) -> list[RecipeFieldChange]:
    values: tuple[tuple[RecipeFieldName, RecipeFieldValue, RecipeFieldValue], ...] = (
        ("title", base.title, target.title),
        ("description", base.description, target.description),
        ("servings", base.servings, target.servings),
    )
    return [
        RecipeFieldChange(field=field, before=before, after=after)
        for field, before, after in values
        if before != after
    ]


def _ingredient_diff(
    base: RecipeVersion,
    target: RecipeVersion,
    substitution_pairs: set[tuple[UUID, UUID]],
) -> RecipeIngredientDiff:
    before_items = sorted(base.ingredients, key=_ingredient_order)
    after_items = sorted(target.ingredients, key=_ingredient_order)
    same_pairs, unmatched_before, unmatched_after = _pair_same_ingredients(
        before_items,
        after_items,
    )
    replacement_pairs, removed, added = _pair_direct_substitutions(
        unmatched_before,
        unmatched_after,
        substitution_pairs,
    )

    modified = []
    for before, after in sorted(
        same_pairs,
        key=lambda pair: (*_ingredient_order(pair[0]), *_ingredient_order(pair[1])),
    ):
        changed_fields = _ingredient_changed_fields(before, after)
        if changed_fields:
            modified.append(
                RecipeIngredientPairChange(
                    before=_ingredient_snapshot(before),
                    after=_ingredient_snapshot(after),
                    changed_fields=changed_fields,
                )
            )

    replaced = [
        RecipeIngredientPairChange(
            before=_ingredient_snapshot(before),
            after=_ingredient_snapshot(after),
            changed_fields=_ingredient_changed_fields(before, after),
        )
        for before, after in replacement_pairs
    ]
    return RecipeIngredientDiff(
        added=[_ingredient_snapshot(item) for item in sorted(added, key=_ingredient_order)],
        removed=[_ingredient_snapshot(item) for item in sorted(removed, key=_ingredient_order)],
        replaced=replaced,
        modified=modified,
    )


def _instruction_diff(
    base: RecipeVersion,
    target: RecipeVersion,
) -> RecipeInstructionDiff:
    before_items = sorted(base.instructions, key=_instruction_order)
    after_items = sorted(target.instructions, key=_instruction_order)
    _exact, remaining_before, remaining_after = _pair_exact_occurrences(
        before_items,
        after_items,
        signature=lambda item: item.instruction,
    )

    shared_count = min(len(remaining_before), len(remaining_after))
    modified = [
        RecipeInstructionPairChange(
            before=_instruction_snapshot(before),
            after=_instruction_snapshot(after),
            changed_fields=["text"],
        )
        for before, after in zip(
            remaining_before[:shared_count],
            remaining_after[:shared_count],
            strict=True,
        )
    ]
    return RecipeInstructionDiff(
        added=[_instruction_snapshot(item) for item in remaining_after[shared_count:]],
        removed=[_instruction_snapshot(item) for item in remaining_before[shared_count:]],
        modified=modified,
    )


def _has_items(groups: Iterable[Sequence[object]]) -> bool:
    return any(groups)


def build_recipe_diff(
    base: RecipeVersion,
    target: RecipeVersion,
    substitution_pairs: set[tuple[UUID, UUID]],
) -> RecipeDiffResponse:
    """Build a canonical content diff from two immutable recipe snapshots.

    The database does not retain copied-row ancestry, so this function does not
    claim to replay authored fork operations. It matches equal ingredient
    identities first, recognizes only curated directed substitutions as
    replacements, and uses stable relative order for otherwise-unmatched
    instruction text.
    """

    metadata_changes = _metadata_changes(base, target)
    ingredients = _ingredient_diff(base, target, substitution_pairs)
    instructions = _instruction_diff(base, target)
    has_changes = bool(metadata_changes) or _has_items(
        (
            ingredients.added,
            ingredients.removed,
            ingredients.replaced,
            ingredients.modified,
            instructions.added,
            instructions.removed,
            instructions.modified,
        )
    )
    return RecipeDiffResponse(
        lineage_id=target.lineage_id,
        base_version=RecipeVersionReference.model_validate(base),
        target_version=RecipeVersionReference.model_validate(target),
        metadata_changes=metadata_changes,
        ingredients=ingredients,
        instructions=instructions,
        has_changes=has_changes,
    )
