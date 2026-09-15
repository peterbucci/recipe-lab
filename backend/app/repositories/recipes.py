from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from typing import cast as type_cast
from uuid import UUID

from sqlalchemy import ColumnElement, Numeric, and_, cast, exists, func, or_, select
from sqlalchemy.orm import Session, aliased, contains_eager, joinedload, raiseload, selectinload

from app.db.query import LIKE_ESCAPE, literal_contains_pattern
from app.models import (
    Recipe,
    RecipeEdition,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionMeasure,
    RecipeRating,
    RecipeSave,
    RecipeStructuralFingerprint,
    RecipeVersion,
    RecipeVersionCategory,
    RecipeVersionPublication,
    User,
)
from app.policies.recipe_visibility import (
    publicly_readable_recipe_publication_filter as _publicly_readable_recipe_publication_filter,
)
from app.policies.recipe_visibility import (
    publicly_readable_recipe_version_filter as _publicly_readable_recipe_version_filter,
)
from app.repositories.ingredients import resolve_ingredient_name


@dataclass(frozen=True, slots=True)
class RecipeBrowseResult:
    items: list[RecipeVersion]
    total: int


@dataclass(frozen=True, slots=True)
class RecipeCardEngagementAggregate:
    average_rating: Decimal | None
    rating_count: int
    save_count: int


@dataclass(frozen=True, slots=True)
class PublicRecipeDuplicateCandidate:
    """Public recipe identity plus the immutable structure used by preflight."""

    recipe_version_id: UUID
    title: str
    algorithm_version: str
    digest: str
    canonical_payload: str


MAX_PUBLIC_RECIPE_HISTORY_EDITIONS = 100
MAX_PUBLIC_RECIPE_HISTORY_ADAPTATIONS = 100


@dataclass(frozen=True, slots=True)
class PublicRecipeHistoryEntry:
    """One readable exact version plus its non-descriptive topology identifiers."""

    recipe_version_id: UUID
    recipe_id: UUID
    edition_number: int
    relation_kind: Literal["original", "adaptation", "revision"]
    previous_recipe_version_id: UUID | None
    adaptation_source_version_id: UUID | None
    declared_change_reason: Literal["correction", "update"] | None
    is_current: bool
    title: str
    published_at: datetime
    author: User


@dataclass(frozen=True, slots=True)
class PublicRecipeHistory:
    """Bounded public history for the stable recipe containing one selected version."""

    recipe_id: UUID
    selected_recipe_version_id: UUID
    current_recipe_version_id: UUID | None
    editions: list[PublicRecipeHistoryEntry]
    adaptations: list[PublicRecipeHistoryEntry]
    editions_truncated: bool
    adaptations_truncated: bool


def current_recipe_version_filter() -> ColumnElement[bool]:
    """Match the explicit current edition of one stable recipe."""

    return exists(
        select(1)
        .select_from(RecipeEdition)
        .join(Recipe, Recipe.id == RecipeEdition.recipe_id)
        .where(
            RecipeEdition.recipe_version_id == RecipeVersion.id,
            Recipe.current_recipe_version_id == RecipeVersion.id,
        )
    )


def _stable_recipe_origin_relation_filter(
    relation_kind: Literal["original", "adaptation"],
) -> ColumnElement[bool]:
    """Classify a current edition by its stable recipe's first publication."""

    current_edition = aliased(RecipeEdition)
    stable_recipe = aliased(Recipe)
    first_edition = aliased(RecipeEdition)
    return exists(
        select(1)
        .select_from(current_edition)
        .join(stable_recipe, stable_recipe.id == current_edition.recipe_id)
        .join(
            first_edition,
            and_(
                first_edition.recipe_id == stable_recipe.id,
                first_edition.edition_number == 1,
            ),
        )
        .where(
            current_edition.recipe_version_id == RecipeVersion.id,
            stable_recipe.current_recipe_version_id == RecipeVersion.id,
            first_edition.relation_kind == relation_kind,
        )
    )


def recipe_summary_load_options() -> tuple[Any, ...]:
    """Eager-load the bounded public identity required by every recipe summary."""

    readable_current_version = (
        joinedload(RecipeVersion.edition)
        .joinedload(RecipeEdition.recipe)
        .joinedload(Recipe.current_edition)
        .joinedload(RecipeEdition.recipe_version.and_(_publicly_readable_recipe_version_filter()))
    )
    return (
        joinedload(RecipeVersion.author),
        joinedload(RecipeVersion.publication),
        readable_current_version.joinedload(RecipeVersion.author),
        readable_current_version.joinedload(RecipeVersion.publication),
    )


def recipe_card_load_options() -> tuple[Any, ...]:
    """Eager-load one summary card and bounded readable adaptation context."""

    readable_parent = selectinload(
        RecipeVersion.parent.and_(_publicly_readable_recipe_version_filter())
    )
    return (
        *recipe_summary_load_options(),
        readable_parent.joinedload(RecipeVersion.author),
        readable_parent.joinedload(RecipeVersion.publication),
        selectinload(RecipeVersion.categories),
        raiseload("*"),
    )


def get_public_recipe_adaptation_sources(
    session: Session,
    recipe_versions: Sequence[RecipeVersion],
) -> dict[UUID, RecipeVersion]:
    """Resolve each target's stable-origin adaptation source in one bounded query."""

    sources: dict[UUID, RecipeVersion] = {}
    revision_ids: list[UUID] = []
    for version in recipe_versions:
        edition = version.edition
        if edition is None:
            raise RuntimeError(f"Public recipe version {version.id} has no stable edition.")
        if edition.relation_kind == "adaptation":
            parent = version.parent
            if (
                parent is not None
                and parent.publication is not None
                and parent.publication.state == "published"
            ):
                sources[version.id] = parent
        elif edition.relation_kind == "revision":
            revision_ids.append(version.id)

    unique_revision_ids = tuple(dict.fromkeys(revision_ids))
    if not unique_revision_ids:
        return sources

    target_edition = aliased(RecipeEdition)
    origin_edition = aliased(RecipeEdition)
    origin_version = aliased(RecipeVersion)
    source_version = aliased(RecipeVersion)
    source_publication = aliased(RecipeVersionPublication)
    statement = (
        select(target_edition.recipe_version_id, source_version)
        .select_from(target_edition)
        .join(
            origin_edition,
            and_(
                origin_edition.recipe_id == target_edition.recipe_id,
                origin_edition.edition_number == 1,
                origin_edition.relation_kind == "adaptation",
            ),
        )
        .join(
            origin_version,
            origin_version.id == origin_edition.recipe_version_id,
        )
        .join(
            source_version,
            source_version.id == origin_version.parent_version_id,
        )
        .join(
            source_publication,
            and_(
                source_publication.recipe_version_id == source_version.id,
                source_publication.actor_user_id == source_version.created_by_user_id,
                source_publication.state == "published",
            ),
        )
        .options(
            joinedload(source_version.author),
            contains_eager(source_version.publication, alias=source_publication),
            raiseload("*"),
        )
        .where(target_edition.recipe_version_id.in_(unique_revision_ids))
        .order_by(target_edition.recipe_version_id)
    )
    sources.update(
        {recipe_version_id: source for recipe_version_id, source in session.execute(statement)}
    )
    return sources


def _recipe_detail_load_options() -> tuple[Any, ...]:
    """Eager-load the complete exact snapshot plus bounded public context."""

    readable_parent = selectinload(
        RecipeVersion.parent.and_(_publicly_readable_recipe_version_filter())
    )
    return (
        *recipe_summary_load_options(),
        readable_parent.joinedload(RecipeVersion.author),
        readable_parent.joinedload(RecipeVersion.publication),
        selectinload(
            RecipeVersion.descendants.and_(_publicly_readable_recipe_version_filter())
        ).joinedload(RecipeVersion.author),
        selectinload(RecipeVersion.categories),
        selectinload(RecipeVersion.ingredients).options(
            joinedload(RecipeIngredient.ingredient),
            joinedload(RecipeIngredient.measurement_unit),
        ),
        selectinload(RecipeVersion.instructions)
        .selectinload(RecipeInstruction.actions)
        .options(
            joinedload(RecipeInstructionAction.action_type),
            selectinload(RecipeInstructionAction.inputs),
            selectinload(RecipeInstructionAction.measures).joinedload(
                RecipeInstructionActionMeasure.measurement_unit
            ),
        ),
        raiseload("*"),
    )


def browse_recipe_versions(
    session: Session,
    *,
    search: str | None,
    lineage_id: UUID | None,
    ingredient_name: str | None,
    is_variant: bool | None,
    category_slug: str | None = None,
    sort: Literal["title", "newest"] = "title",
    offset: int,
    limit: int,
) -> RecipeBrowseResult:
    """List readable current editions with deterministic filtering and ordering."""

    filters: list[ColumnElement[bool]] = []
    if search is not None:
        pattern = literal_contains_pattern(search)
        filters.append(
            or_(
                RecipeVersion.title.ilike(pattern, escape=LIKE_ESCAPE),
                RecipeVersion.description.ilike(
                    pattern,
                    escape=LIKE_ESCAPE,
                ),
            )
        )
    if lineage_id is not None:
        filters.append(RecipeVersion.lineage_id == lineage_id)
    if is_variant is not None:
        filters.append(
            _stable_recipe_origin_relation_filter("adaptation")
            if is_variant
            else _stable_recipe_origin_relation_filter("original")
        )
    if ingredient_name is not None:
        ingredient = resolve_ingredient_name(session, ingredient_name)
        if ingredient is None:
            return RecipeBrowseResult(items=[], total=0)
        filters.append(
            exists().where(
                RecipeIngredient.recipe_version_id == RecipeVersion.id,
                RecipeIngredient.ingredient_id == ingredient.id,
            )
        )
    if category_slug is not None:
        filters.append(
            exists().where(
                RecipeVersionCategory.recipe_version_id == RecipeVersion.id,
                RecipeVersionCategory.category_slug == category_slug,
            )
        )

    filters.extend(
        (
            _publicly_readable_recipe_version_filter(),
            current_recipe_version_filter(),
        )
    )
    total = session.scalar(select(func.count()).select_from(RecipeVersion).where(*filters))
    ordering: tuple[Any, ...]
    if sort == "title":
        ordering = (
            func.lower(func.btrim(RecipeVersion.title)),
            func.btrim(RecipeVersion.title),
            RecipeVersion.version_number,
            RecipeVersion.id,
        )
    elif sort == "newest":
        published_at = (
            select(RecipeVersionPublication.published_at)
            .where(
                RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
                _publicly_readable_recipe_publication_filter(),
            )
            .correlate(RecipeVersion)
            .scalar_subquery()
        )
        stable_recipe_id = (
            select(RecipeEdition.recipe_id)
            .where(RecipeEdition.recipe_version_id == RecipeVersion.id)
            .correlate(RecipeVersion)
            .scalar_subquery()
        )
        ordering = (published_at.desc(), stable_recipe_id)
    else:
        raise ValueError(f"Unsupported recipe browse sort {sort!r}.")

    statement = (
        select(RecipeVersion)
        .options(*recipe_card_load_options())
        .where(*filters)
        .order_by(*ordering)
        .offset(offset)
        .limit(limit)
    )
    items = list(session.scalars(statement))
    return RecipeBrowseResult(items=items, total=total or 0)


def list_public_current_recipe_versions_in_order(
    session: Session,
    recipe_ids: tuple[UUID, ...],
) -> list[RecipeVersion]:
    """Resolve stable editorial selections to readable current editions in order."""

    if not recipe_ids:
        return []
    if len(recipe_ids) != len(set(recipe_ids)):
        raise ValueError("Editorial recipe selections cannot contain duplicate IDs.")

    statement = (
        select(Recipe.id, RecipeVersion)
        .join(RecipeEdition, RecipeEdition.recipe_id == Recipe.id)
        .join(
            RecipeVersion,
            and_(
                RecipeVersion.id == RecipeEdition.recipe_version_id,
                RecipeVersion.id == Recipe.current_recipe_version_id,
            ),
        )
        .options(*recipe_card_load_options())
        .where(
            Recipe.id.in_(recipe_ids),
            _publicly_readable_recipe_version_filter(),
        )
    )
    recipes_by_id = {recipe_id: version for recipe_id, version in session.execute(statement)}
    return [recipes_by_id[recipe_id] for recipe_id in recipe_ids if recipe_id in recipes_by_id]


def get_recipe_version(
    session: Session,
    recipe_version_id: UUID,
) -> RecipeVersion | None:
    """Load one complete recipe snapshot and its immediate lineage context."""

    statement = (
        select(RecipeVersion)
        .options(*_recipe_detail_load_options())
        .where(
            RecipeVersion.id == recipe_version_id,
            _publicly_readable_recipe_version_filter(),
        )
    )
    return session.scalar(statement)


def get_current_recipe_version(
    session: Session,
    recipe_id: UUID,
) -> RecipeVersion | None:
    """Load only a stable recipe's explicitly selected readable current edition."""

    statement = (
        select(RecipeVersion)
        .join(RecipeEdition, RecipeEdition.recipe_version_id == RecipeVersion.id)
        .join(Recipe, Recipe.id == RecipeEdition.recipe_id)
        .options(*_recipe_detail_load_options())
        .where(
            Recipe.id == recipe_id,
            Recipe.current_recipe_version_id == RecipeVersion.id,
            _publicly_readable_recipe_version_filter(),
        )
    )
    return session.scalar(statement)


def _public_recipe_history_entry(
    *,
    recipe_version_id: UUID,
    recipe_id: UUID,
    edition_number: int,
    relation_kind: str,
    previous_recipe_version_id: UUID | None,
    adaptation_source_version_id: UUID | None,
    declared_change_reason: str | None,
    is_current: bool,
    title: str,
    published_at: datetime,
    author: User,
) -> PublicRecipeHistoryEntry:
    return PublicRecipeHistoryEntry(
        recipe_version_id=recipe_version_id,
        recipe_id=recipe_id,
        edition_number=edition_number,
        relation_kind=type_cast(
            Literal["original", "adaptation", "revision"],
            relation_kind,
        ),
        previous_recipe_version_id=previous_recipe_version_id,
        adaptation_source_version_id=adaptation_source_version_id,
        declared_change_reason=type_cast(
            Literal["correction", "update"] | None,
            declared_change_reason,
        ),
        is_current=is_current,
        title=title,
        published_at=published_at,
        author=author,
    )


def get_public_recipe_history(
    session: Session,
    selected_recipe_version_id: UUID,
) -> PublicRecipeHistory | None:
    """Load bounded readable editions and current adaptations for one stable recipe.

    Exact topology identifiers are retained even when the referenced version is hidden,
    but hidden versions never contribute descriptive history records. A hidden current
    edition also never falls back to an older readable edition.
    """

    recipe_id = session.scalar(
        select(RecipeEdition.recipe_id)
        .join(
            RecipeVersionPublication,
            RecipeVersionPublication.recipe_version_id == RecipeEdition.recipe_version_id,
        )
        .where(
            RecipeEdition.recipe_version_id == selected_recipe_version_id,
            _publicly_readable_recipe_publication_filter(),
        )
    )
    if recipe_id is None:
        return None

    origin_edition = aliased(RecipeEdition)
    origin_version = aliased(RecipeVersion)
    adaptation_source_version_id = session.scalar(
        select(origin_version.parent_version_id)
        .select_from(origin_edition)
        .join(origin_version, origin_version.id == origin_edition.recipe_version_id)
        .where(
            origin_edition.recipe_id == recipe_id,
            origin_edition.edition_number == 1,
        )
    )

    edition_author = aliased(User)
    edition_rows = list(
        session.execute(
            select(
                RecipeVersion.id,
                RecipeEdition.recipe_id,
                RecipeEdition.edition_number,
                RecipeEdition.relation_kind,
                RecipeEdition.previous_recipe_version_id,
                RecipeEdition.declared_change_reason,
                RecipeVersion.title,
                RecipeVersionPublication.published_at,
                edition_author,
            )
            .select_from(RecipeEdition)
            .join(RecipeVersion, RecipeVersion.id == RecipeEdition.recipe_version_id)
            .join(
                RecipeVersionPublication,
                RecipeVersionPublication.recipe_version_id == RecipeVersion.id,
            )
            .join(edition_author, edition_author.id == RecipeVersion.created_by_user_id)
            .where(
                RecipeEdition.recipe_id == recipe_id,
                _publicly_readable_recipe_publication_filter(),
            )
            .order_by(RecipeEdition.edition_number)
            .limit(MAX_PUBLIC_RECIPE_HISTORY_EDITIONS + 1)
        )
    )
    editions_truncated = len(edition_rows) > MAX_PUBLIC_RECIPE_HISTORY_EDITIONS

    adaptation_recipe = aliased(Recipe)
    adaptation_origin_edition = aliased(RecipeEdition)
    adaptation_origin_version = aliased(RecipeVersion)
    source_edition = aliased(RecipeEdition)
    adaptation_current_edition = aliased(RecipeEdition)
    adaptation_current_version = aliased(RecipeVersion)
    adaptation_current_author = aliased(User)
    adaptation_rows = list(
        session.execute(
            select(
                adaptation_current_version.id,
                adaptation_current_edition.recipe_id,
                adaptation_current_edition.edition_number,
                adaptation_current_edition.relation_kind,
                adaptation_current_edition.previous_recipe_version_id,
                adaptation_origin_version.parent_version_id,
                adaptation_current_edition.declared_change_reason,
                adaptation_current_version.title,
                RecipeVersionPublication.published_at,
                adaptation_current_author,
            )
            .select_from(adaptation_recipe)
            .join(
                adaptation_origin_edition,
                and_(
                    adaptation_origin_edition.recipe_id == adaptation_recipe.id,
                    adaptation_origin_edition.edition_number == 1,
                    adaptation_origin_edition.relation_kind == "adaptation",
                ),
            )
            .join(
                adaptation_origin_version,
                adaptation_origin_version.id == adaptation_origin_edition.recipe_version_id,
            )
            .join(
                source_edition,
                and_(
                    source_edition.recipe_version_id == adaptation_origin_version.parent_version_id,
                    source_edition.recipe_id == recipe_id,
                ),
            )
            .join(
                adaptation_current_edition,
                and_(
                    adaptation_current_edition.recipe_id == adaptation_recipe.id,
                    adaptation_current_edition.recipe_version_id
                    == adaptation_recipe.current_recipe_version_id,
                ),
            )
            .join(
                adaptation_current_version,
                adaptation_current_version.id == adaptation_current_edition.recipe_version_id,
            )
            .join(
                RecipeVersionPublication,
                RecipeVersionPublication.recipe_version_id == adaptation_current_version.id,
            )
            .join(
                adaptation_current_author,
                adaptation_current_author.id == adaptation_current_version.created_by_user_id,
            )
            .where(_publicly_readable_recipe_publication_filter())
            .order_by(
                RecipeVersionPublication.published_at.desc(),
                adaptation_recipe.id,
            )
            .limit(MAX_PUBLIC_RECIPE_HISTORY_ADAPTATIONS + 1)
        )
    )
    adaptations_truncated = len(adaptation_rows) > MAX_PUBLIC_RECIPE_HISTORY_ADAPTATIONS

    limited_edition_rows = edition_rows[:MAX_PUBLIC_RECIPE_HISTORY_EDITIONS]
    limited_adaptation_rows = adaptation_rows[:MAX_PUBLIC_RECIPE_HISTORY_ADAPTATIONS]
    candidate_recipe_version_ids = tuple(
        dict.fromkeys(
            [
                selected_recipe_version_id,
                *(row[0] for row in limited_edition_rows),
                *(row[0] for row in limited_adaptation_rows),
            ]
        )
    )
    readable_current_recipe_version_id = (
        select(RecipeVersionPublication.recipe_version_id)
        .select_from(Recipe)
        .join(
            RecipeVersionPublication,
            RecipeVersionPublication.recipe_version_id == Recipe.current_recipe_version_id,
        )
        .where(
            Recipe.id == recipe_id,
            _publicly_readable_recipe_publication_filter(),
        )
        .scalar_subquery()
    )
    # Under READ COMMITTED the earlier bounded reads can become stale. Recheck every
    # descriptive candidate, the selected version, adaptation-current membership, and the
    # selected recipe's readable current pointer in one final statement. This keeps the
    # response fail-closed without taking locks on a public GET.
    final_visibility_rows = list(
        session.execute(
            select(
                RecipeVersion.id,
                current_recipe_version_filter().label("is_current"),
                readable_current_recipe_version_id.label("selected_current_recipe_version_id"),
            ).where(
                RecipeVersion.id.in_(candidate_recipe_version_ids),
                _publicly_readable_recipe_version_filter(),
            )
        )
    )
    final_visibility = {
        recipe_version_id: is_current
        for recipe_version_id, is_current, _current_recipe_version_id in final_visibility_rows
    }
    if selected_recipe_version_id not in final_visibility:
        return None
    current_recipe_version_id = final_visibility_rows[0][2]

    editions = [
        _public_recipe_history_entry(
            recipe_version_id=recipe_version_id,
            recipe_id=row_recipe_id,
            edition_number=edition_number,
            relation_kind=relation_kind,
            previous_recipe_version_id=previous_recipe_version_id,
            adaptation_source_version_id=adaptation_source_version_id,
            declared_change_reason=declared_change_reason,
            is_current=recipe_version_id == current_recipe_version_id,
            title=title,
            published_at=published_at,
            author=author,
        )
        for (
            recipe_version_id,
            row_recipe_id,
            edition_number,
            relation_kind,
            previous_recipe_version_id,
            declared_change_reason,
            title,
            published_at,
            author,
        ) in limited_edition_rows
        if recipe_version_id in final_visibility
    ]
    adaptations = [
        _public_recipe_history_entry(
            recipe_version_id=recipe_version_id,
            recipe_id=row_recipe_id,
            edition_number=edition_number,
            relation_kind=relation_kind,
            previous_recipe_version_id=previous_recipe_version_id,
            adaptation_source_version_id=row_adaptation_source_version_id,
            declared_change_reason=declared_change_reason,
            is_current=True,
            title=title,
            published_at=published_at,
            author=author,
        )
        for (
            recipe_version_id,
            row_recipe_id,
            edition_number,
            relation_kind,
            previous_recipe_version_id,
            row_adaptation_source_version_id,
            declared_change_reason,
            title,
            published_at,
            author,
        ) in limited_adaptation_rows
        if final_visibility.get(recipe_version_id, False)
    ]
    return PublicRecipeHistory(
        recipe_id=recipe_id,
        selected_recipe_version_id=selected_recipe_version_id,
        current_recipe_version_id=current_recipe_version_id,
        editions=editions,
        adaptations=adaptations,
        editions_truncated=editions_truncated,
        adaptations_truncated=adaptations_truncated,
    )


def browse_public_recipe_versions_by_author(
    session: Session,
    *,
    author_user_id: UUID,
    offset: int,
    limit: int,
) -> RecipeBrowseResult:
    """List readable current editions authored by one exact user."""

    filters = (
        RecipeVersion.created_by_user_id == author_user_id,
        _publicly_readable_recipe_version_filter(),
        current_recipe_version_filter(),
    )
    total = session.scalar(select(func.count()).select_from(RecipeVersion).where(*filters)) or 0
    statement = (
        select(RecipeVersion)
        .options(*recipe_card_load_options())
        .where(*filters)
        .order_by(RecipeVersion.created_at.desc(), RecipeVersion.id)
        .offset(offset)
        .limit(limit)
    )
    return RecipeBrowseResult(items=list(session.scalars(statement)), total=total)


def list_public_recipe_duplicate_candidates(
    session: Session,
    *,
    algorithm_version: str,
    subject_digest: str,
    subject_canonical_payload: str,
    subject_ingredient_identities: Sequence[str],
    comparison_limit: int,
    exact_candidate_limit: int,
    exclude_recipe_version_id: UUID | None = None,
) -> list[PublicRecipeDuplicateCandidate]:
    """Load a bounded, deterministic public shortlist for preflight scoring.

    Exact structural matches are selected first through the fingerprint index. If
    they do not fill the response bound, probable candidates are shortlisted by
    descending distinct canonical-ingredient overlap and stable UUID tie-break.
    The caller still applies the complete versioned scorer to every returned row.
    """

    if comparison_limit <= 0:
        raise ValueError("Duplicate candidate comparison limit must be positive.")
    if exact_candidate_limit <= 0 or exact_candidate_limit > comparison_limit:
        raise ValueError(
            "Exact duplicate candidate limit must be positive and no greater "
            "than the comparison limit."
        )

    exact_statement = (
        select(
            RecipeVersion.id,
            RecipeVersion.title,
            RecipeStructuralFingerprint.algorithm_version,
            RecipeStructuralFingerprint.digest,
            RecipeStructuralFingerprint.canonical_payload,
        )
        .join(
            RecipeStructuralFingerprint,
            RecipeStructuralFingerprint.recipe_version_id == RecipeVersion.id,
        )
        .where(
            _publicly_readable_recipe_version_filter(),
            RecipeStructuralFingerprint.algorithm_version == algorithm_version,
            RecipeStructuralFingerprint.digest == subject_digest,
            RecipeStructuralFingerprint.canonical_payload == subject_canonical_payload,
        )
        .order_by(RecipeVersion.id)
        .limit(exact_candidate_limit)
    )
    if exclude_recipe_version_id is not None:
        exact_statement = exact_statement.where(RecipeVersion.id != exclude_recipe_version_id)

    exact_candidates = [
        PublicRecipeDuplicateCandidate(
            recipe_version_id=recipe_version_id,
            title=title,
            algorithm_version=stored_algorithm_version,
            digest=digest,
            canonical_payload=canonical_payload,
        )
        for (
            recipe_version_id,
            title,
            stored_algorithm_version,
            digest,
            canonical_payload,
        ) in session.execute(exact_statement)
    ]
    if len(exact_candidates) >= exact_candidate_limit:
        return exact_candidates

    try:
        subject_ingredient_ids = tuple(
            sorted({UUID(identity) for identity in subject_ingredient_identities}, key=str)
        )
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError("Canonical ingredient identities must be UUIDs.") from error
    if not subject_ingredient_ids:
        return exact_candidates

    probable_limit = comparison_limit - len(exact_candidates)
    overlap_count = func.count(func.distinct(RecipeIngredient.ingredient_id)).label(
        "canonical_ingredient_overlap"
    )
    shortlist_statement = (
        select(
            RecipeIngredient.recipe_version_id.label("recipe_version_id"),
            overlap_count,
        )
        .select_from(RecipeIngredient)
        .join(
            RecipeVersion,
            RecipeVersion.id == RecipeIngredient.recipe_version_id,
        )
        .join(
            RecipeStructuralFingerprint,
            RecipeStructuralFingerprint.recipe_version_id == RecipeVersion.id,
        )
        .where(
            RecipeIngredient.ingredient_id.in_(subject_ingredient_ids),
            _publicly_readable_recipe_version_filter(),
            RecipeStructuralFingerprint.algorithm_version == algorithm_version,
        )
        .group_by(RecipeIngredient.recipe_version_id)
        .order_by(overlap_count.desc(), RecipeIngredient.recipe_version_id)
        .limit(probable_limit)
    )
    excluded_ids = [candidate.recipe_version_id for candidate in exact_candidates]
    if exclude_recipe_version_id is not None:
        shortlist_statement = shortlist_statement.where(
            RecipeVersion.id != exclude_recipe_version_id
        )
    if excluded_ids:
        shortlist_statement = shortlist_statement.where(RecipeVersion.id.not_in(excluded_ids))
    shortlist = shortlist_statement.subquery()

    probable_statement = (
        select(
            RecipeVersion.id,
            RecipeVersion.title,
            RecipeStructuralFingerprint.algorithm_version,
            RecipeStructuralFingerprint.digest,
            RecipeStructuralFingerprint.canonical_payload,
        )
        .join(shortlist, shortlist.c.recipe_version_id == RecipeVersion.id)
        .join(
            RecipeStructuralFingerprint,
            RecipeStructuralFingerprint.recipe_version_id == RecipeVersion.id,
        )
        .where(RecipeStructuralFingerprint.algorithm_version == algorithm_version)
        .order_by(shortlist.c.canonical_ingredient_overlap.desc(), RecipeVersion.id)
    )
    probable_candidates = [
        PublicRecipeDuplicateCandidate(
            recipe_version_id=recipe_version_id,
            title=title,
            algorithm_version=stored_algorithm_version,
            digest=digest,
            canonical_payload=canonical_payload,
        )
        for (
            recipe_version_id,
            title,
            stored_algorithm_version,
            digest,
            canonical_payload,
        ) in session.execute(probable_statement)
    ]
    return [*exact_candidates, *probable_candidates]


def get_public_recipe_version_titles(
    session: Session,
    recipe_version_ids: set[UUID],
) -> dict[UUID, str]:
    """Resolve public candidate display metadata without exposing hidden counts."""

    if not recipe_version_ids:
        return {}
    statement = select(RecipeVersion.id, RecipeVersion.title).where(
        _publicly_readable_recipe_version_filter(),
        RecipeVersion.id.in_(recipe_version_ids),
    )
    return {recipe_version_id: title for recipe_version_id, title in session.execute(statement)}


def get_recipe_card_engagement_aggregates(
    session: Session,
    recipe_version_ids: list[UUID],
) -> dict[UUID, RecipeCardEngagementAggregate]:
    """Return anonymous card totals in two bounded aggregate queries."""

    if not recipe_version_ids:
        return {}

    unique_ids = tuple(dict.fromkeys(recipe_version_ids))
    rating_rows = {
        recipe_version_id: (average, int(count))
        for recipe_version_id, average, count in session.execute(
            select(
                RecipeRating.recipe_version_id,
                cast(func.avg(RecipeRating.rating), Numeric(3, 2)),
                func.count(RecipeRating.user_id),
            )
            .where(RecipeRating.recipe_version_id.in_(unique_ids))
            .group_by(RecipeRating.recipe_version_id)
        )
    }
    save_rows = {
        recipe_version_id: int(count)
        for recipe_version_id, count in session.execute(
            select(
                RecipeSave.recipe_version_id,
                func.count(RecipeSave.user_id),
            )
            .where(RecipeSave.recipe_version_id.in_(unique_ids))
            .group_by(RecipeSave.recipe_version_id)
        )
    }

    return {
        recipe_version_id: RecipeCardEngagementAggregate(
            average_rating=rating_rows.get(recipe_version_id, (None, 0))[0],
            rating_count=rating_rows.get(recipe_version_id, (None, 0))[1],
            save_count=save_rows.get(recipe_version_id, 0),
        )
        for recipe_version_id in unique_ids
    }
