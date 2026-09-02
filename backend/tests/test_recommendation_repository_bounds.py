from collections.abc import Callable
from typing import Any, cast
from uuid import UUID

from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import Session

from app.repositories import recommendations as repository

USER_ID = UUID("20000000-0000-4000-8000-000000000001")
FIRST_ID = UUID("10000000-0000-4000-8000-000000000001")
SECOND_ID = UUID("10000000-0000-4000-8000-000000000002")
THIRD_ID = UUID("10000000-0000-4000-8000-000000000003")


def _literal_sql(statement: Any) -> str:
    dialect_factory = cast(Callable[[], Dialect], postgresql.dialect)
    return str(
        statement.compile(
            dialect=dialect_factory(),
            compile_kwargs={"literal_binds": True},
        )
    )


def test_global_shortlist_is_bounded_and_orders_by_the_baseline_score() -> None:
    eligible = repository._eligible_candidate_pool(None)
    sql = _literal_sql(repository._global_shortlist_statement(eligible, 37))

    assert "LIMIT 37" in sql
    assert "round(" in sql
    assert "global_score DESC" in sql
    assert "maximum_save_count" in sql
    assert "recipe_version_publications.state = 'published'" in sql
    assert "LIMIT 38" not in sql


def test_signed_in_pool_excludes_every_exact_private_interaction_in_sql() -> None:
    sql = _literal_sql(
        repository._global_shortlist_statement(repository._eligible_candidate_pool(USER_ID), 50)
    )

    assert "NOT (EXISTS" in sql
    assert "recipe_saves.user_id" in sql
    assert "recipe_ratings.user_id" in sql
    assert "preference_events.user_id" in sql
    assert "preference_events.related_recipe_version_id = recipe_versions.id" in sql
    assert str(USER_ID) in sql


def test_personalized_lane_uses_public_canonical_ingredient_overlap() -> None:
    eligible = repository._eligible_candidate_pool(USER_ID)
    sql = _literal_sql(
        repository._personalized_shortlist_statement(
            eligible,
            (FIRST_ID, SECOND_ID),
            25,
        )
    )

    assert "recipe_version_ingredients.ingredient_id" in sql
    assert "count(DISTINCT recipe_version_ingredients.ingredient_id)" in sql
    assert "overlap_count DESC" in sql
    assert "recipe_version_publications.state = 'published'" in sql
    assert "LIMIT 25" in sql


def test_positive_source_ids_keep_semantic_order_deduplicate_and_bound() -> None:
    profile = repository._ProfileData(
        saved_recipe_version_ids=(FIRST_ID,),
        ratings=(repository.RecommendationUserRating(FIRST_ID, 5),),
        events=(
            repository.RecommendationUserEvent(SECOND_ID, "fork", THIRD_ID),
            repository.RecommendationUserEvent(THIRD_ID, "view", None),
        ),
    )

    assert repository._positive_source_ids(profile, 2) == (FIRST_ID, SECOND_ID)
    assert repository._positive_source_ids(profile, 5) == (
        FIRST_ID,
        SECOND_ID,
        THIRD_ID,
    )


class _SavedCapacitySession:
    def __init__(self) -> None:
        self.saved_statement: Any = None
        self.execute_calls = 0

    def scalars(self, statement: Any) -> tuple[UUID, UUID]:
        self.saved_statement = statement
        return FIRST_ID, SECOND_ID

    def execute(self, _statement: Any) -> tuple[object, ...]:
        self.execute_calls += 1
        return ()


def test_profile_degrades_to_strongest_current_signals_without_overflow() -> None:
    session = _SavedCapacitySession()

    profile = repository._load_profile_data(cast(Session, session), USER_ID, 2)

    assert profile.saved_recipe_version_ids == (FIRST_ID, SECOND_ID)
    assert profile.ratings == ()
    assert profile.events == ()
    assert session.execute_calls == 0
    sql = _literal_sql(session.saved_statement)
    assert "recipe_saves.created_at DESC" in sql
    assert "LIMIT 2" in sql
    assert "LIMIT 3" not in sql


class _RecentProfileSession:
    def __init__(self) -> None:
        self.execute_statements: list[Any] = []

    def scalars(self, _statement: Any) -> tuple[()]:
        return ()

    def execute(self, statement: Any) -> tuple[tuple[Any, ...], ...]:
        self.execute_statements.append(statement)
        if len(self.execute_statements) == 1:
            return ((FIRST_ID, 5),)
        return ((SECOND_ID, "fork", THIRD_ID),)


def test_profile_policy_prefers_positive_ratings_then_distinct_recent_events() -> None:
    session = _RecentProfileSession()

    profile = repository._load_profile_data(cast(Session, session), USER_ID, 2)

    assert profile.ratings == (repository.RecommendationUserRating(FIRST_ID, 5),)
    assert profile.events == (repository.RecommendationUserEvent(SECOND_ID, "fork", THIRD_ID),)
    rating_sql = _literal_sql(session.execute_statements[0])
    event_sql = _literal_sql(session.execute_statements[1])
    assert "recipe_ratings.rating >= 4" in rating_sql
    assert "recipe_ratings.rating DESC" in rating_sql
    assert "preference_events.event_type IN ('fork', 'view')" in event_sql
    assert "GROUP BY" in event_sql
    assert "max(preference_events.occurred_at) DESC" in event_sql


def test_shortlist_policy_version_is_explicit_and_stable() -> None:
    assert repository.RECOMMENDATION_SHORTLIST_POLICY == "baseline-v1-shortlist-v1"
