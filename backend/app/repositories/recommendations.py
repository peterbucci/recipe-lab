from dataclasses import dataclass
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

from sqlalchemy import Numeric, case, distinct, exists, func, select
from sqlalchemy import cast as sql_cast
from sqlalchemy.orm import Session, joinedload, raiseload, selectinload

from app.core.config import settings
from app.models import (
    PreferenceEvent,
    RecipeIngredient,
    RecipeRating,
    RecipeSave,
    RecipeVersion,
)
from app.policies.recipe_visibility import publicly_readable_recipe_version_filter
from app.services.recommendation_scoring import (
    MAX_RECOMMENDATIONS,
    BaselineNormalization,
    QualitativeIngredientMeasure,
    RecommendationIngredientMeasure,
)

RECOMMENDATION_SHORTLIST_POLICY = "baseline-v1-shortlist-v1"
MAX_RECOMMENDATION_CANDIDATES = settings.research.recommendation_max_candidates
MAX_RECOMMENDATION_PROFILE_RECORDS = settings.research.recommendation_max_profile_records
_PERSONALIZED_LANE_DIVISOR = 2
_ZERO = Decimal(0)


def recommendation_ingredient_measure(item: RecipeIngredient) -> RecommendationIngredientMeasure:
    """Adapt one validated storage row without using its display label."""

    if item.measure_mode == "exact":
        return RecommendationIngredientMeasure(
            ingredient_id=item.ingredient_id,
            kind="exact",
            value=item.quantity_min,
            unit_id=item.measurement_unit_id,
            package_size_id=item.package_size_id,
        )
    if item.measure_mode == "range":
        return RecommendationIngredientMeasure(
            ingredient_id=item.ingredient_id,
            kind="range",
            minimum=item.quantity_min,
            maximum=item.quantity_max,
            unit_id=item.measurement_unit_id,
            package_size_id=item.package_size_id,
        )
    if item.measure_mode in {"to_taste", "as_needed", "unspecified"}:
        return RecommendationIngredientMeasure(
            ingredient_id=item.ingredient_id,
            kind="qualitative",
            qualitative_value=cast(QualitativeIngredientMeasure, item.measure_mode),
        )
    raise RuntimeError(f"Recipe ingredient {item.id} has an unsupported measure mode.")


@dataclass(frozen=True, slots=True)
class RecommendationCandidateData:
    recipe: RecipeVersion
    ingredient_measures: tuple[RecommendationIngredientMeasure, ...]
    rating_sum: int
    rating_count: int
    save_count: int
    fork_count: int
    view_count: int

    @property
    def ingredient_ids(self) -> frozenset[UUID]:
        return frozenset(measure.ingredient_id for measure in self.ingredient_measures)


@dataclass(frozen=True, slots=True)
class RecommendationUserRating:
    recipe_version_id: UUID
    rating: int


@dataclass(frozen=True, slots=True)
class RecommendationUserEvent:
    recipe_version_id: UUID
    event_type: str
    related_recipe_version_id: UUID | None


@dataclass(frozen=True, slots=True)
class RecommendationData:
    candidates: tuple[RecommendationCandidateData, ...]
    saved_recipe_version_ids: frozenset[UUID]
    ratings: tuple[RecommendationUserRating, ...]
    events: tuple[RecommendationUserEvent, ...]
    normalization: BaselineNormalization


@dataclass(frozen=True, slots=True)
class _ProfileData:
    saved_recipe_version_ids: tuple[UUID, ...] = ()
    ratings: tuple[RecommendationUserRating, ...] = ()
    events: tuple[RecommendationUserEvent, ...] = ()


def _aggregate_subqueries() -> tuple[Any, Any, Any]:
    rating_aggregates = (
        select(
            RecipeRating.recipe_version_id.label("recipe_version_id"),
            func.sum(RecipeRating.rating).label("rating_sum"),
            func.count(RecipeRating.user_id).label("rating_count"),
        )
        .group_by(RecipeRating.recipe_version_id)
        .subquery()
    )
    save_aggregates = (
        select(
            RecipeSave.recipe_version_id.label("recipe_version_id"),
            func.count(distinct(RecipeSave.user_id)).label("save_count"),
        )
        .group_by(RecipeSave.recipe_version_id)
        .subquery()
    )
    event_aggregates = (
        select(
            PreferenceEvent.recipe_version_id.label("recipe_version_id"),
            func.count(distinct(PreferenceEvent.user_id))
            .filter(PreferenceEvent.event_type == "fork")
            .label("fork_count"),
            func.count(distinct(PreferenceEvent.user_id))
            .filter(PreferenceEvent.event_type == "view")
            .label("view_count"),
        )
        .where(PreferenceEvent.event_type.in_(("fork", "view")))
        .group_by(PreferenceEvent.recipe_version_id)
        .subquery()
    )
    return rating_aggregates, save_aggregates, event_aggregates


def _member_has_not_interacted(user_id: UUID) -> tuple[Any, ...]:
    saved = exists().where(
        RecipeSave.user_id == user_id,
        RecipeSave.recipe_version_id == RecipeVersion.id,
    )
    rated = exists().where(
        RecipeRating.user_id == user_id,
        RecipeRating.recipe_version_id == RecipeVersion.id,
    )
    direct_event = exists().where(
        PreferenceEvent.user_id == user_id,
        PreferenceEvent.recipe_version_id == RecipeVersion.id,
    )
    related_event = exists().where(
        PreferenceEvent.user_id == user_id,
        PreferenceEvent.related_recipe_version_id == RecipeVersion.id,
    )
    return (~saved, ~rated, ~direct_event, ~related_event)


def _eligible_candidate_pool(user_id: UUID | None) -> Any:
    rating_aggregates, save_aggregates, event_aggregates = _aggregate_subqueries()
    rating_sum = func.coalesce(rating_aggregates.c.rating_sum, 0)
    rating_count = func.coalesce(rating_aggregates.c.rating_count, 0)
    save_count = func.coalesce(save_aggregates.c.save_count, 0)
    fork_count = func.coalesce(event_aggregates.c.fork_count, 0)
    view_count = func.coalesce(event_aggregates.c.view_count, 0)
    maximum_save_count = func.max(save_count).over()
    maximum_fork_count = func.max(fork_count).over()
    maximum_view_count = func.max(view_count).over()

    quality = (
        (sql_cast(rating_sum + 15, Numeric(24, 12)) / (rating_count + 5)) - Decimal(1)
    ) / Decimal(4)
    normalized_saves = func.coalesce(
        sql_cast(save_count, Numeric(24, 12)) / func.nullif(maximum_save_count, 0),
        _ZERO,
    )
    normalized_forks = func.coalesce(
        sql_cast(fork_count, Numeric(24, 12)) / func.nullif(maximum_fork_count, 0),
        _ZERO,
    )
    normalized_views = func.coalesce(
        sql_cast(view_count, Numeric(24, 12)) / func.nullif(maximum_view_count, 0),
        _ZERO,
    )
    global_score = (
        Decimal("0.55") * quality
        + Decimal("0.20") * normalized_saves
        + Decimal("0.15") * normalized_forks
        + Decimal("0.10") * normalized_views
    )

    filters: list[Any] = [publicly_readable_recipe_version_filter()]
    if user_id is not None:
        filters.extend(_member_has_not_interacted(user_id))
    return (
        select(
            RecipeVersion.id.label("recipe_version_id"),
            RecipeVersion.title.label("title"),
            RecipeVersion.version_number.label("version_number"),
            rating_sum.label("rating_sum"),
            rating_count.label("rating_count"),
            save_count.label("save_count"),
            fork_count.label("fork_count"),
            view_count.label("view_count"),
            maximum_save_count.label("maximum_save_count"),
            maximum_fork_count.label("maximum_fork_count"),
            maximum_view_count.label("maximum_view_count"),
            func.round(global_score, 6).label("global_score"),
        )
        .outerjoin(
            rating_aggregates,
            rating_aggregates.c.recipe_version_id == RecipeVersion.id,
        )
        .outerjoin(
            save_aggregates,
            save_aggregates.c.recipe_version_id == RecipeVersion.id,
        )
        .outerjoin(
            event_aggregates,
            event_aggregates.c.recipe_version_id == RecipeVersion.id,
        )
        .where(*filters)
        .cte("eligible_recommendation_candidates")
    )


def _global_shortlist_statement(eligible: Any, capacity: int) -> Any:
    return (
        select(
            eligible.c.recipe_version_id,
            eligible.c.maximum_save_count,
            eligible.c.maximum_fork_count,
            eligible.c.maximum_view_count,
        )
        .order_by(
            eligible.c.global_score.desc(),
            func.lower(func.btrim(eligible.c.title)),
            func.btrim(eligible.c.title),
            eligible.c.version_number,
            eligible.c.recipe_version_id,
        )
        .limit(capacity)
    )


def _personalized_shortlist_statement(
    eligible: Any,
    source_recipe_version_ids: tuple[UUID, ...],
    capacity: int,
) -> Any:
    anchor_ingredients = (
        select(distinct(RecipeIngredient.ingredient_id).label("ingredient_id"))
        .join(
            RecipeVersion,
            RecipeVersion.id == RecipeIngredient.recipe_version_id,
        )
        .where(
            RecipeIngredient.recipe_version_id.in_(source_recipe_version_ids),
            publicly_readable_recipe_version_filter(),
        )
        .subquery()
    )
    overlap = (
        select(
            RecipeIngredient.recipe_version_id.label("recipe_version_id"),
            func.count(distinct(RecipeIngredient.ingredient_id)).label("overlap_count"),
        )
        .where(RecipeIngredient.ingredient_id.in_(select(anchor_ingredients.c.ingredient_id)))
        .group_by(RecipeIngredient.recipe_version_id)
        .subquery()
    )
    return (
        select(eligible.c.recipe_version_id)
        .join(overlap, overlap.c.recipe_version_id == eligible.c.recipe_version_id)
        .where(overlap.c.overlap_count > 0)
        .order_by(
            overlap.c.overlap_count.desc(),
            eligible.c.global_score.desc(),
            func.lower(func.btrim(eligible.c.title)),
            func.btrim(eligible.c.title),
            eligible.c.version_number,
            eligible.c.recipe_version_id,
        )
        .limit(capacity)
    )


def _load_profile_data(session: Session, user_id: UUID, capacity: int) -> _ProfileData:
    """Prefer current strong signals, then recent distinct fork/view signals."""

    if capacity <= 0:
        return _ProfileData()
    saved_rows = tuple(
        session.scalars(
            select(RecipeSave.recipe_version_id)
            .where(RecipeSave.user_id == user_id)
            .order_by(RecipeSave.created_at.desc(), RecipeSave.recipe_version_id)
            .limit(capacity)
        )
    )
    remaining = capacity - len(saved_rows)
    rating_rows: tuple[Any, ...] = ()
    if remaining > 0:
        rating_rows = tuple(
            session.execute(
                select(RecipeRating.recipe_version_id, RecipeRating.rating)
                .where(
                    RecipeRating.user_id == user_id,
                    RecipeRating.rating >= 4,
                )
                .order_by(
                    RecipeRating.rating.desc(),
                    RecipeRating.created_at.desc(),
                    RecipeRating.recipe_version_id,
                )
                .limit(remaining)
            )
        )
    ratings = tuple(
        RecommendationUserRating(recipe_version_id=recipe_version_id, rating=int(rating))
        for recipe_version_id, rating in rating_rows
    )
    remaining -= len(ratings)
    event_rows: tuple[Any, ...] = ()
    if remaining > 0:
        latest_event_at = func.max(PreferenceEvent.occurred_at)
        event_rows = tuple(
            session.execute(
                select(
                    PreferenceEvent.recipe_version_id,
                    PreferenceEvent.event_type,
                    PreferenceEvent.related_recipe_version_id,
                )
                .where(
                    PreferenceEvent.user_id == user_id,
                    PreferenceEvent.event_type.in_(("fork", "view")),
                )
                .group_by(
                    PreferenceEvent.recipe_version_id,
                    PreferenceEvent.event_type,
                    PreferenceEvent.related_recipe_version_id,
                )
                .order_by(
                    case((PreferenceEvent.event_type == "fork", 0), else_=1),
                    latest_event_at.desc(),
                    PreferenceEvent.recipe_version_id,
                    PreferenceEvent.related_recipe_version_id.nulls_last(),
                )
                .limit(remaining)
            )
        )
    events = tuple(
        RecommendationUserEvent(
            recipe_version_id=recipe_version_id,
            event_type=event_type,
            related_recipe_version_id=related_recipe_version_id,
        )
        for recipe_version_id, event_type, related_recipe_version_id in event_rows
    )
    return _ProfileData(
        saved_recipe_version_ids=saved_rows,
        ratings=ratings,
        events=events,
    )


def _positive_source_ids(profile: _ProfileData, capacity: int) -> tuple[UUID, ...]:
    ordered: list[UUID] = []
    seen: set[UUID] = set()

    def include(recipe_version_id: UUID | None) -> None:
        if recipe_version_id is None or recipe_version_id in seen or len(ordered) >= capacity:
            return
        seen.add(recipe_version_id)
        ordered.append(recipe_version_id)

    for recipe_version_id in profile.saved_recipe_version_ids:
        include(recipe_version_id)
    for rating in profile.ratings:
        include(rating.recipe_version_id)
    for event in profile.events:
        include(event.recipe_version_id)
        if event.event_type == "fork":
            include(event.related_recipe_version_id)
    return tuple(ordered)


def _load_shortlist(
    session: Session,
    *,
    user_id: UUID | None,
    source_recipe_version_ids: tuple[UUID, ...],
    capacity: int,
) -> tuple[tuple[UUID, ...], BaselineNormalization]:
    if capacity <= 0:
        return (), BaselineNormalization()
    eligible = _eligible_candidate_pool(user_id)
    global_rows = tuple(session.execute(_global_shortlist_statement(eligible, capacity)))
    normalization = (
        BaselineNormalization(
            maximum_save_count=int(global_rows[0][1]),
            maximum_fork_count=int(global_rows[0][2]),
            maximum_view_count=int(global_rows[0][3]),
        )
        if global_rows
        else BaselineNormalization()
    )
    global_ids = tuple(cast(UUID, row[0]) for row in global_rows)
    personalized_ids: tuple[UUID, ...] = ()
    if source_recipe_version_ids:
        personalized_capacity = capacity // _PERSONALIZED_LANE_DIVISOR
        if personalized_capacity > 0:
            personalized_ids = tuple(
                session.scalars(
                    _personalized_shortlist_statement(
                        eligible,
                        source_recipe_version_ids,
                        personalized_capacity,
                    )
                )
            )

    shortlist: list[UUID] = []
    seen: set[UUID] = set()
    for recipe_version_id in (*personalized_ids, *global_ids):
        if recipe_version_id in seen:
            continue
        seen.add(recipe_version_id)
        shortlist.append(recipe_version_id)
        if len(shortlist) == capacity:
            break
    return tuple(shortlist), normalization


def _load_candidate_details(
    session: Session,
    recipe_version_ids: tuple[UUID, ...],
) -> tuple[RecommendationCandidateData, ...]:
    if not recipe_version_ids:
        return ()
    rating_aggregates, save_aggregates, event_aggregates = _aggregate_subqueries()
    statement = (
        select(
            RecipeVersion,
            func.coalesce(rating_aggregates.c.rating_sum, 0),
            func.coalesce(rating_aggregates.c.rating_count, 0),
            func.coalesce(save_aggregates.c.save_count, 0),
            func.coalesce(event_aggregates.c.fork_count, 0),
            func.coalesce(event_aggregates.c.view_count, 0),
        )
        .outerjoin(
            rating_aggregates,
            rating_aggregates.c.recipe_version_id == RecipeVersion.id,
        )
        .outerjoin(
            save_aggregates,
            save_aggregates.c.recipe_version_id == RecipeVersion.id,
        )
        .outerjoin(
            event_aggregates,
            event_aggregates.c.recipe_version_id == RecipeVersion.id,
        )
        .where(
            RecipeVersion.id.in_(recipe_version_ids),
            publicly_readable_recipe_version_filter(),
        )
        .options(
            joinedload(RecipeVersion.author),
            joinedload(RecipeVersion.publication),
            selectinload(
                RecipeVersion.parent.and_(publicly_readable_recipe_version_filter())
            ).joinedload(RecipeVersion.author),
            selectinload(RecipeVersion.categories),
            selectinload(RecipeVersion.ingredients),
            raiseload("*"),
        )
        .order_by(
            func.lower(func.btrim(RecipeVersion.title)),
            func.btrim(RecipeVersion.title),
            RecipeVersion.version_number,
            RecipeVersion.id,
        )
    )
    return tuple(
        RecommendationCandidateData(
            recipe=recipe,
            ingredient_measures=tuple(
                recommendation_ingredient_measure(item) for item in recipe.ingredients
            ),
            rating_sum=int(rating_sum),
            rating_count=int(rating_count),
            save_count=int(save_count),
            fork_count=int(fork_count),
            view_count=int(view_count),
        )
        for recipe, rating_sum, rating_count, save_count, fork_count, view_count in session.execute(
            statement
        )
    )


def load_recommendation_data(
    session: Session,
    user_id: UUID | None,
) -> RecommendationData:
    """Load a deterministic bounded shortlist and the active member's strongest history."""

    source_capacity = max(0, MAX_RECOMMENDATION_CANDIDATES - MAX_RECOMMENDATIONS)
    profile = (
        _load_profile_data(
            session,
            user_id,
            min(MAX_RECOMMENDATION_PROFILE_RECORDS, source_capacity),
        )
        if user_id is not None
        else _ProfileData()
    )
    source_recipe_version_ids = _positive_source_ids(profile, source_capacity)
    candidate_capacity = MAX_RECOMMENDATION_CANDIDATES - len(source_recipe_version_ids)
    shortlist_ids, normalization = _load_shortlist(
        session,
        user_id=user_id,
        source_recipe_version_ids=source_recipe_version_ids,
        capacity=candidate_capacity,
    )
    detail_ids = tuple(dict.fromkeys((*shortlist_ids, *source_recipe_version_ids)))
    return RecommendationData(
        candidates=_load_candidate_details(session, detail_ids),
        saved_recipe_version_ids=frozenset(profile.saved_recipe_version_ids),
        ratings=profile.ratings,
        events=profile.events,
        normalization=normalization,
    )
