from __future__ import annotations

from collections import Counter, defaultdict, deque
from collections.abc import Callable, Hashable, Iterable, Sequence
from decimal import Decimal
from typing import Protocol
from uuid import UUID

from app.models import (
    ACTION_PARAMETER_DURATION,
    ACTION_PARAMETER_TEMPERATURE,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeVersion,
)
from app.schemas.recipe_diffs import (
    RecipeDiffResponse,
    RecipeFieldChange,
    RecipeFieldName,
    RecipeFieldValue,
    RecipeIngredientChangedField,
    RecipeIngredientContext,
    RecipeIngredientDiff,
    RecipeIngredientPairChange,
    RecipeInstructionChangedField,
    RecipeInstructionDiff,
    RecipeInstructionPairChange,
)
from app.schemas.recipes import RecipeIngredientResponse, RecipeInstructionResponse
from app.services.actions import serialize_instruction_action
from app.services.measurements import serialize_measure
from app.services.recipe_responses import recipe_version_reference


class _OrderedIdentified(Protocol):
    id: UUID
    display_order: int


_INGREDIENT_FIELD_ORDER: tuple[RecipeIngredientChangedField, ...] = (
    "ingredient",
    "display_name",
    "measure",
    "preparation_notes",
)
_INSTRUCTION_FIELD_ORDER: tuple[RecipeInstructionChangedField, ...] = (
    "title",
    "text",
    "actions",
    "inputs",
    "action_order",
    "duration",
    "temperature",
)

type _IngredientReferenceToken = tuple[str, int]
type _ActionMeasureSignature = tuple[str, Decimal, Decimal | None, UUID] | None
type _ActionSignature = tuple[
    UUID,
    tuple[_IngredientReferenceToken, ...],
    _ActionMeasureSignature,
    _ActionMeasureSignature,
]


def _ingredient_order(item: RecipeIngredient) -> tuple[int, int]:
    return item.display_order, item.id.int


def _instruction_order(item: RecipeInstruction) -> tuple[int, int]:
    return item.display_order, item.id.int


def _measure_signature(
    item: RecipeIngredient,
) -> tuple[str, Decimal | None, Decimal | None, UUID | None, UUID | None]:
    return (
        item.measure_mode,
        item.quantity_min,
        item.quantity_max,
        item.measurement_unit_id,
        item.package_size_id,
    )


def _ingredient_signature(
    item: RecipeIngredient,
) -> tuple[
    str,
    tuple[str, Decimal | None, Decimal | None, UUID | None, UUID | None],
    str | None,
]:
    return item.name, _measure_signature(item), item.preparation_notes


def _replacement_candidate_order(
    before: RecipeIngredient,
    after: RecipeIngredient,
) -> tuple[int, bool, bool, int, int, int]:
    """Prefer replacements that preserve amount semantics before row position."""

    content_changes = (
        _measure_signature(before) != _measure_signature(after),
        before.preparation_notes != after.preparation_notes,
    )
    return (
        sum(content_changes),
        *content_changes,
        abs(before.display_order - after.display_order),
        *_ingredient_order(after),
    )


def _pair_exact_occurrences[Item: _OrderedIdentified, Signature: Hashable](
    before_items: list[Item],
    after_items: list[Item],
    *,
    signature: Callable[[Item], Signature],
) -> tuple[list[tuple[Item, Item]], list[Item], list[Item]]:
    """Pair equal duplicate occurrences without depending on collection order."""

    after_by_signature: dict[Signature, list[Item]] = defaultdict(list)
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
        matched_index = min(
            range(len(candidates)),
            key=lambda index: (
                abs(item.display_order - candidates[index].display_order),
                candidates[index].display_order,
                candidates[index].id.int,
            ),
        )
        matched = candidates.pop(matched_index)
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
        measure=serialize_measure(
            kind=item.measure_mode,
            quantity_min=item.quantity_min,
            quantity_max=item.quantity_max,
            unit=item.measurement_unit,
            package_size_id=item.package_size_id,
        ),
        preparation_notes=item.preparation_notes,
        display_order=item.display_order,
    )


def _instruction_snapshot(item: RecipeInstruction) -> RecipeInstructionResponse:
    return RecipeInstructionResponse(
        id=item.id,
        title=item.title,
        text=item.instruction,
        display_order=item.display_order,
        actions=[
            serialize_instruction_action(action)
            for action in sorted(
                item.actions, key=lambda value: (value.display_order, value.id.int)
            )
        ],
    )


def _ingredient_reference_tokens(
    base: RecipeVersion,
    target: RecipeVersion,
) -> tuple[
    dict[UUID, _IngredientReferenceToken],
    dict[UUID, _IngredientReferenceToken],
]:
    """Map copied occurrences to shared comparison-local identities.

    Occurrence UUIDs are regenerated for every immutable fork. Pairing only the
    same curated ingredient identity keeps a copied graph equal while ensuring
    an action input that changes to a substituted ingredient remains visible.
    """

    same_pairs, unmatched_before, unmatched_after = _pair_same_ingredients(
        sorted(base.ingredients, key=_ingredient_order),
        sorted(target.ingredients, key=_ingredient_order),
    )
    base_tokens: dict[UUID, _IngredientReferenceToken] = {}
    target_tokens: dict[UUID, _IngredientReferenceToken] = {}
    for index, (before, after) in enumerate(
        sorted(
            same_pairs,
            key=lambda pair: (*_ingredient_order(pair[0]), *_ingredient_order(pair[1])),
        )
    ):
        token = ("paired", index)
        base_tokens[before.id] = token
        target_tokens[after.id] = token
    for index, item in enumerate(sorted(unmatched_before, key=_ingredient_order)):
        base_tokens[item.id] = ("base", index)
    for index, item in enumerate(sorted(unmatched_after, key=_ingredient_order)):
        target_tokens[item.id] = ("target", index)
    return base_tokens, target_tokens


def _action_order(item: RecipeInstructionAction) -> tuple[int, int]:
    return item.display_order, item.id.int


def _action_measure_signature(
    item: RecipeInstructionAction,
    semantic: str,
) -> _ActionMeasureSignature:
    matching = [measure for measure in item.measures if measure.semantic == semantic]
    if not matching:
        return None
    if len(matching) != 1:
        raise RuntimeError(f"Action {item.id} contains duplicate {semantic} measures.")
    measure = matching[0]
    return (
        measure.measure_mode,
        measure.quantity_min,
        measure.quantity_max,
        measure.measurement_unit_id,
    )


def _action_input_signature(
    item: RecipeInstructionAction,
    tokens: dict[UUID, _IngredientReferenceToken],
) -> tuple[_IngredientReferenceToken, ...]:
    values: list[_IngredientReferenceToken] = []
    for action_input in sorted(
        item.inputs,
        key=lambda value: (value.display_order, value.id.int),
    ):
        try:
            values.append(tokens[action_input.recipe_ingredient_id])
        except KeyError as error:
            raise RuntimeError(
                f"Action {item.id} references ingredient occurrence "
                f"{action_input.recipe_ingredient_id} outside its recipe snapshot."
            ) from error
    return tuple(values)


def _action_signature(
    item: RecipeInstructionAction,
    tokens: dict[UUID, _IngredientReferenceToken],
) -> _ActionSignature:
    return (
        item.action_type_id,
        _action_input_signature(item, tokens),
        _action_measure_signature(item, ACTION_PARAMETER_DURATION),
        _action_measure_signature(item, ACTION_PARAMETER_TEMPERATURE),
    )


def _pair_actions(
    before_items: list[RecipeInstructionAction],
    after_items: list[RecipeInstructionAction],
    *,
    before_tokens: dict[UUID, _IngredientReferenceToken],
    after_tokens: dict[UUID, _IngredientReferenceToken],
) -> tuple[list[tuple[RecipeInstructionAction, RecipeInstructionAction]], bool]:
    """Pair action instances without treating freshly generated row IDs as edits."""

    after_by_signature: dict[_ActionSignature, list[RecipeInstructionAction]] = defaultdict(list)
    for item in after_items:
        after_by_signature[_action_signature(item, after_tokens)].append(item)

    pairs: list[tuple[RecipeInstructionAction, RecipeInstructionAction]] = []
    remaining_before: list[RecipeInstructionAction] = []
    matched_after_ids: set[UUID] = set()
    for item in before_items:
        candidates = after_by_signature.get(_action_signature(item, before_tokens))
        if not candidates:
            remaining_before.append(item)
            continue
        matched_index = min(
            range(len(candidates)),
            key=lambda index: (
                abs(item.display_order - candidates[index].display_order),
                *_action_order(candidates[index]),
            ),
        )
        matched = candidates.pop(matched_index)
        pairs.append((item, matched))
        matched_after_ids.add(matched.id)

    remaining_after = [item for item in after_items if item.id not in matched_after_ids]
    before_by_type: dict[UUID, deque[RecipeInstructionAction]] = defaultdict(deque)
    after_by_type: dict[UUID, deque[RecipeInstructionAction]] = defaultdict(deque)
    for item in remaining_before:
        before_by_type[item.action_type_id].append(item)
    for item in remaining_after:
        after_by_type[item.action_type_id].append(item)
    for action_type_id in sorted(
        before_by_type.keys() & after_by_type.keys(), key=lambda value: value.int
    ):
        before_group = before_by_type[action_type_id]
        after_group = after_by_type[action_type_id]
        while before_group and after_group:
            pairs.append((before_group.popleft(), after_group.popleft()))

    before_type_counts = Counter(item.action_type_id for item in before_items)
    after_type_counts = Counter(item.action_type_id for item in after_items)
    return pairs, before_type_counts != after_type_counts


def _instruction_changed_fields(
    before: RecipeInstruction,
    after: RecipeInstruction,
    *,
    before_tokens: dict[UUID, _IngredientReferenceToken],
    after_tokens: dict[UUID, _IngredientReferenceToken],
) -> list[RecipeInstructionChangedField]:
    before_actions = sorted(before.actions, key=_action_order)
    after_actions = sorted(after.actions, key=_action_order)
    action_pairs, actions_changed = _pair_actions(
        before_actions,
        after_actions,
        before_tokens=before_tokens,
        after_tokens=after_tokens,
    )
    action_order_changed = not actions_changed and any(
        before_action.display_order != after_action.display_order
        for before_action, after_action in action_pairs
    )

    inputs_changed = any(
        _action_input_signature(before_action, before_tokens)
        != _action_input_signature(after_action, after_tokens)
        for before_action, after_action in action_pairs
    )
    duration_changed = any(
        _action_measure_signature(before_action, ACTION_PARAMETER_DURATION)
        != _action_measure_signature(after_action, ACTION_PARAMETER_DURATION)
        for before_action, after_action in action_pairs
    )
    temperature_changed = any(
        _action_measure_signature(before_action, ACTION_PARAMETER_TEMPERATURE)
        != _action_measure_signature(after_action, ACTION_PARAMETER_TEMPERATURE)
        for before_action, after_action in action_pairs
    )
    changed = {
        "title": before.title != after.title,
        "text": before.instruction != after.instruction,
        "actions": actions_changed,
        "inputs": inputs_changed,
        "action_order": action_order_changed,
        "duration": duration_changed,
        "temperature": temperature_changed,
    }
    return [field for field in _INSTRUCTION_FIELD_ORDER if changed[field]]


def _ingredient_changed_fields(
    before: RecipeIngredient,
    after: RecipeIngredient,
) -> list[RecipeIngredientChangedField]:
    changed = {
        "ingredient": before.ingredient_id != after.ingredient_id,
        "display_name": before.name != after.name,
        "measure": _measure_signature(before) != _measure_signature(after),
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
        ("total_time_minutes", base.total_time_minutes, target.total_time_minutes),
        ("active_time_minutes", base.active_time_minutes, target.active_time_minutes),
        ("difficulty", base.difficulty, target.difficulty),
        ("notes", base.notes, target.notes),
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
    *,
    before_tokens: dict[UUID, _IngredientReferenceToken],
    after_tokens: dict[UUID, _IngredientReferenceToken],
) -> RecipeInstructionDiff:
    before_items = sorted(base.instructions, key=_instruction_order)
    after_items = sorted(target.instructions, key=_instruction_order)
    all_tokens = {**before_tokens, **after_tokens}
    _exact, remaining_before, remaining_after = _pair_exact_occurrences(
        before_items,
        after_items,
        signature=lambda item: (
            item.title,
            item.instruction,
            tuple(
                _action_signature(action, all_tokens)
                for action in sorted(item.actions, key=_action_order)
            ),
        ),
    )

    shared_count = min(len(remaining_before), len(remaining_after))
    modified = []
    for before, after in zip(
        remaining_before[:shared_count],
        remaining_after[:shared_count],
        strict=True,
    ):
        changed_fields = _instruction_changed_fields(
            before,
            after,
            before_tokens=before_tokens,
            after_tokens=after_tokens,
        )
        if changed_fields:
            modified.append(
                RecipeInstructionPairChange(
                    before=_instruction_snapshot(before),
                    after=_instruction_snapshot(after),
                    changed_fields=changed_fields,
                )
            )
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
    before_tokens, after_tokens = _ingredient_reference_tokens(base, target)
    instructions = _instruction_diff(
        base,
        target,
        before_tokens=before_tokens,
        after_tokens=after_tokens,
    )
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
        base_version=recipe_version_reference(base),
        target_version=recipe_version_reference(target),
        metadata_changes=metadata_changes,
        ingredients=ingredients,
        ingredient_context=RecipeIngredientContext(
            base=[
                _ingredient_snapshot(item)
                for item in sorted(base.ingredients, key=_ingredient_order)
            ],
            target=[
                _ingredient_snapshot(item)
                for item in sorted(target.ingredients, key=_ingredient_order)
            ],
        ),
        instructions=instructions,
        has_changes=has_changes,
    )
