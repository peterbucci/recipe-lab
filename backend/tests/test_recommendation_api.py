import json
import re
from collections.abc import Iterator
from decimal import Decimal
from typing import Any, cast
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    PreferenceEvent,
    RecipeIngredient,
    RecipeInstruction,
    RecipeInstructionAction,
    RecipeInstructionActionInput,
    RecipeInstructionActionMeasure,
    RecipeRating,
    RecipeSave,
    RecipeVersion,
    User,
)
from app.repositories import recommendations as recommendation_repository
from app.repositories.recommendations import load_recommendation_data
from app.seeds.identifiers import seed_uuid
from tests.application import application_with_database
from tests.member_session import (
    MemberCredentials,
    authenticate_client,
    create_member_credentials,
)

DATASET_ID = "recipe-lab-demo-v1"
CARROT_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "carrot-walnut-snack-cake-v1",
)
CARROT_PECAN_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "lower-sugar-pecan-carrot-cake-v2",
)
CARROT_ORANGE_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "orange-raisin-carrot-cake-v3",
)
BROWN_RICE_BOWL_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "brown-rice-chickpea-bowl-v2",
)
PASTA_ROOT_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "tomato-basil-spaghetti-v1",
)
TUNA_SALAD_ID = seed_uuid(
    DATASET_ID,
    "recipe-version",
    "tuna-white-bean-salad-v1",
)
TEST_USER_EMAIL_PATTERN = "rcp15-%@test.invalid"
SIX_DECIMAL_PATTERN = re.compile(r"^[0-9]+\.[0-9]{6}$")
MEMBER_USER_ID = UUID("77000000-0000-4000-8000-000000000004")


def _clear_recommendation_activity(engine: Engine) -> None:
    with Session(bind=engine) as session, session.begin():
        synthetic_user_ids = list(
            session.scalars(select(User.id).where(User.email.like(TEST_USER_EMAIL_PATTERN)))
        )
        if synthetic_user_ids:
            session.execute(delete(User).where(User.id.in_(synthetic_user_ids)))

        member_fork_ids = list(
            session.scalars(
                select(RecipeVersion.id).where(RecipeVersion.created_by_user_id == MEMBER_USER_ID)
            )
        )
        event_filter = PreferenceEvent.user_id == MEMBER_USER_ID
        if member_fork_ids:
            event_filter = or_(
                event_filter,
                PreferenceEvent.recipe_version_id.in_(member_fork_ids),
                PreferenceEvent.related_recipe_version_id.in_(member_fork_ids),
            )
        session.execute(delete(PreferenceEvent).where(event_filter))
        session.execute(delete(RecipeRating).where(RecipeRating.user_id == MEMBER_USER_ID))
        session.execute(delete(RecipeSave).where(RecipeSave.user_id == MEMBER_USER_ID))

        if member_fork_ids:
            action_ids = select(RecipeInstructionAction.id).where(
                RecipeInstructionAction.recipe_version_id.in_(member_fork_ids)
            )
            session.execute(
                delete(RecipeRating).where(RecipeRating.recipe_version_id.in_(member_fork_ids))
            )
            session.execute(
                delete(RecipeSave).where(RecipeSave.recipe_version_id.in_(member_fork_ids))
            )
            session.execute(
                delete(RecipeInstructionActionMeasure).where(
                    RecipeInstructionActionMeasure.recipe_instruction_action_id.in_(action_ids)
                )
            )
            session.execute(
                delete(RecipeInstructionActionInput).where(
                    RecipeInstructionActionInput.recipe_version_id.in_(member_fork_ids)
                )
            )
            session.execute(
                delete(RecipeInstructionAction).where(
                    RecipeInstructionAction.recipe_version_id.in_(member_fork_ids)
                )
            )
            session.execute(
                delete(RecipeIngredient).where(
                    RecipeIngredient.recipe_version_id.in_(member_fork_ids)
                )
            )
            session.execute(
                delete(RecipeInstruction).where(
                    RecipeInstruction.recipe_version_id.in_(member_fork_ids)
                )
            )
            session.execute(delete(RecipeVersion).where(RecipeVersion.id.in_(member_fork_ids)))


@pytest.fixture(autouse=True)
def clean_recommendation_activity(seeded_api_engine: Engine) -> Iterator[None]:
    _clear_recommendation_activity(seeded_api_engine)
    try:
        yield
    finally:
        _clear_recommendation_activity(seeded_api_engine)


@pytest.fixture(autouse=True)
def test_member_credentials(
    seeded_api_engine: Engine,
    clean_recommendation_activity: None,
) -> Iterator[MemberCredentials]:
    credentials = create_member_credentials(seeded_api_engine, user_id=MEMBER_USER_ID)
    try:
        yield credentials
    finally:
        _clear_recommendation_activity(seeded_api_engine)
        with Session(bind=seeded_api_engine) as session, session.begin():
            session.execute(delete(User).where(User.id == MEMBER_USER_ID))


@pytest.fixture
def recommendation_client(
    seeded_api_engine: Engine,
    test_member_credentials: MemberCredentials,
) -> Iterator[TestClient]:
    with application_with_database(seeded_api_engine) as application:
        with TestClient(application) as client:
            authenticate_client(client, test_member_credentials)
            yield client


def _json_object(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value)


def _items(response: dict[str, Any]) -> list[dict[str, Any]]:
    return cast(list[dict[str, Any]], response["items"])


def _item_for(response: dict[str, Any], recipe_version_id: UUID) -> dict[str, Any]:
    expected_id = str(recipe_version_id)
    return next(item for item in _items(response) if item["recipe"]["id"] == expected_id)


def _create_test_users(engine: Engine, count: int) -> list[UUID]:
    user_ids = [uuid4() for _ in range(count)]
    with Session(bind=engine) as session, session.begin():
        session.add_all(
            [
                User(
                    id=user_id,
                    email=f"rcp15-{user_id}@test.invalid",
                    display_name=f"Recommendation test user {index}",
                )
                for index, user_id in enumerate(user_ids, start=1)
            ]
        )
    return user_ids


def _event(
    *,
    user_id: UUID,
    recipe_version_id: UUID,
    event_type: str,
    saved_value: bool | None = None,
    rating_value: int | None = None,
    related_recipe_version_id: UUID | None = None,
    request_fingerprint: str | None = None,
) -> PreferenceEvent:
    return PreferenceEvent(
        id=uuid4(),
        user_id=user_id,
        recipe_version_id=recipe_version_id,
        event_type=event_type,
        saved_value=saved_value,
        rating_value=rating_value,
        related_recipe_version_id=related_recipe_version_id,
        request_fingerprint=request_fingerprint,
    )


def _table_counts(engine: Engine) -> tuple[int, int, int, int]:
    with Session(bind=engine) as session:
        counts = tuple(
            session.scalar(select(func.count()).select_from(model)) or 0
            for model in (PreferenceEvent, RecipeSave, RecipeRating, RecipeVersion)
        )
    return cast(tuple[int, int, int, int], counts)


def test_recommendation_adapter_retains_structured_measure_signals(
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session:
        data = load_recommendation_data(session, None)
        candidate = next(item for item in data.candidates if item.recipe.id == CARROT_ROOT_ID)

        assert len(candidate.ingredient_measures) == len(candidate.recipe.ingredients)
        assert candidate.ingredient_ids == frozenset(
            measure.ingredient_id for measure in candidate.ingredient_measures
        )
        assert all(measure.kind == "exact" for measure in candidate.ingredient_measures)
        assert all(measure.value is not None for measure in candidate.ingredient_measures)
        assert all(measure.unit_id is not None for measure in candidate.ingredient_measures)
        assert all(measure.package_size_id is None for measure in candidate.ingredient_measures)


def test_unpublished_snapshot_is_not_a_recommendation_candidate(
    recommendation_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        source = session.get(RecipeVersion, CARROT_ROOT_ID)
        assert source is not None
        latest_version_number = session.scalar(
            select(func.max(RecipeVersion.version_number)).where(
                RecipeVersion.lineage_id == source.lineage_id
            )
        )
        assert latest_version_number is not None
        hidden = RecipeVersion(
            lineage_id=source.lineage_id,
            parent_version_id=source.id,
            created_by_user_id=MEMBER_USER_ID,
            version_number=latest_version_number + 1,
            title="Unpublished recommendation sentinel",
            description="An inserted snapshot without a publication receipt.",
            servings=Decimal("1.00"),
        )
        session.add(hidden)
        session.flush()
        hidden_id = hidden.id

    response = recommendation_client.get("/api/recommendations", params={"limit": 50})

    assert response.status_code == 200
    returned_ids = {item["recipe"]["id"] for item in _items(_json_object(response.json()))}
    assert str(hidden_id) not in returned_ids


def test_cold_start_is_stable_bounded_and_uses_the_published_weights(
    recommendation_client: TestClient,
) -> None:
    first_response = recommendation_client.get("/api/recommendations")
    repeated_response = recommendation_client.get("/api/recommendations")
    limited_response = recommendation_client.get("/api/recommendations", params={"limit": 3})

    assert first_response.status_code == 200
    assert repeated_response.status_code == 200
    assert limited_response.status_code == 200
    assert first_response.content == repeated_response.content

    body = _json_object(first_response.json())
    assert set(body) == {"strategy", "personalized", "weights", "items"}
    assert body["strategy"] == "baseline-v1"
    assert body["personalized"] is False
    assert len(_items(body)) == 10
    assert _items(_json_object(limited_response.json())) == _items(body)[:3]

    weights = _json_object(body["weights"])
    assert Decimal(weights["quality"]) == Decimal("0.55")
    assert Decimal(weights["saves"]) == Decimal("0.20")
    assert Decimal(weights["forks"]) == Decimal("0.15")
    assert Decimal(weights["views"]) == Decimal("0.10")
    assert Decimal(weights["personalized_global"]) == Decimal("0.60")
    assert Decimal(weights["personalized_similarity"]) == Decimal("0.40")
    assert Decimal(weights["quality_prior_mean"]) == Decimal("3")
    assert weights["quality_prior_strength"] == 5

    titles = [item["recipe"]["title"] for item in _items(body)]
    assert titles == sorted(titles, key=lambda title: (title.casefold(), title))
    assert len({item["recipe"]["id"] for item in _items(body)}) == 10
    for item in _items(body):
        recipe = _json_object(item["recipe"])
        assert recipe["author"] == {
            "id": str(seed_uuid(DATASET_ID, "user", "catalog-author")),
            "handle": "recipe-lab-catalog",
            "display_name": "Recipe Lab Demo Catalog",
        }
        assert set(recipe["author"]) == {"id", "handle", "display_name"}
        if recipe["parent"] is not None:
            assert set(recipe["parent"]["author"]) == {"id", "handle", "display_name"}
        assert SIX_DECIMAL_PATTERN.fullmatch(item["score"])
        assert item["score"] == "0.275000"
        assert 1 <= len(item["reason"]) <= 200
        components = _json_object(item["components"])
        assert components == {
            "quality": "0.500000",
            "save_popularity": "0.000000",
            "fork_popularity": "0.000000",
            "view_popularity": "0.000000",
            "global_score": "0.275000",
            "ingredient_similarity": "0.000000",
        }


def test_global_score_uses_bayesian_quality_and_normalized_distinct_support(
    recommendation_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    first_user_id, second_user_id = _create_test_users(seeded_api_engine, 2)
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.add_all(
            [
                RecipeRating(
                    user_id=first_user_id,
                    recipe_version_id=CARROT_ROOT_ID,
                    rating=5,
                ),
                RecipeSave(
                    user_id=first_user_id,
                    recipe_version_id=CARROT_ROOT_ID,
                ),
                RecipeSave(
                    user_id=first_user_id,
                    recipe_version_id=BROWN_RICE_BOWL_ID,
                ),
                RecipeSave(
                    user_id=second_user_id,
                    recipe_version_id=BROWN_RICE_BOWL_ID,
                ),
                _event(
                    user_id=first_user_id,
                    recipe_version_id=CARROT_ROOT_ID,
                    event_type="view",
                ),
                _event(
                    user_id=first_user_id,
                    recipe_version_id=CARROT_ROOT_ID,
                    event_type="view",
                ),
                _event(
                    user_id=first_user_id,
                    recipe_version_id=BROWN_RICE_BOWL_ID,
                    event_type="view",
                ),
                _event(
                    user_id=second_user_id,
                    recipe_version_id=BROWN_RICE_BOWL_ID,
                    event_type="view",
                ),
                _event(
                    user_id=first_user_id,
                    recipe_version_id=CARROT_ROOT_ID,
                    event_type="fork",
                    related_recipe_version_id=CARROT_PECAN_ID,
                    request_fingerprint="a" * 64,
                ),
            ]
        )

    response = recommendation_client.get("/api/recommendations", params={"limit": 34})

    assert response.status_code == 200
    body = _json_object(response.json())
    assert body["personalized"] is False
    carrot = _item_for(body, CARROT_ROOT_ID)
    assert carrot["score"] == "0.620833"
    assert carrot["components"] == {
        "quality": "0.583333",
        "save_popularity": "0.500000",
        "fork_popularity": "1.000000",
        "view_popularity": "0.500000",
        "global_score": "0.620833",
        "ingredient_similarity": "0.000000",
    }
    assert _items(body)[0]["recipe"]["id"] == str(CARROT_ROOT_ID)


def test_active_save_personalizes_by_canonical_ingredient_similarity(
    recommendation_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.add(
            RecipeSave(
                user_id=MEMBER_USER_ID,
                recipe_version_id=CARROT_ROOT_ID,
            )
        )
        session.add(
            _event(
                user_id=MEMBER_USER_ID,
                recipe_version_id=CARROT_ROOT_ID,
                event_type="save",
                saved_value=True,
            )
        )

    response = recommendation_client.get("/api/recommendations", params={"limit": 34})

    assert response.status_code == 200
    body = _json_object(response.json())
    assert body["personalized"] is True
    items = _items(body)
    assert str(CARROT_ROOT_ID) not in {item["recipe"]["id"] for item in items}
    assert [item["recipe"]["id"] for item in items[:2]] == [
        str(CARROT_PECAN_ID),
        str(CARROT_ORANGE_ID),
    ]

    pecan = _item_for(body, CARROT_PECAN_ID)
    orange = _item_for(body, CARROT_ORANGE_ID)
    assert pecan["score"] == "0.485000"
    assert pecan["components"]["global_score"] == "0.275000"
    assert pecan["components"]["ingredient_similarity"] == "0.800000"
    assert orange["score"] == "0.455909"
    assert orange["components"]["ingredient_similarity"] == "0.727273"
    assert "you saved" in pecan["reason"].casefold()


def test_stale_save_and_rating_events_do_not_become_positive_profile_sources(
    recommendation_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.add_all(
            [
                _event(
                    user_id=MEMBER_USER_ID,
                    recipe_version_id=CARROT_ROOT_ID,
                    event_type="save",
                    saved_value=True,
                ),
                _event(
                    user_id=MEMBER_USER_ID,
                    recipe_version_id=CARROT_ROOT_ID,
                    event_type="save",
                    saved_value=False,
                ),
                _event(
                    user_id=MEMBER_USER_ID,
                    recipe_version_id=PASTA_ROOT_ID,
                    event_type="rating",
                    rating_value=5,
                ),
                _event(
                    user_id=MEMBER_USER_ID,
                    recipe_version_id=PASTA_ROOT_ID,
                    event_type="rating",
                    rating_value=3,
                ),
                RecipeRating(
                    user_id=MEMBER_USER_ID,
                    recipe_version_id=PASTA_ROOT_ID,
                    rating=3,
                ),
            ]
        )

    response = recommendation_client.get("/api/recommendations", params={"limit": 50})

    assert response.status_code == 200
    body = _json_object(response.json())
    assert body["personalized"] is False
    items = _items(body)
    assert len(items) == 32
    returned_ids = {item["recipe"]["id"] for item in items}
    assert str(CARROT_ROOT_ID) not in returned_ids
    assert str(PASTA_ROOT_ID) not in returned_ids
    assert {item["score"] for item in items} == {"0.275000"}
    assert {item["components"]["ingredient_similarity"] for item in items} == {"0.000000"}


def test_recommendation_reads_do_not_mutate_or_expose_profile_data(
    recommendation_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    (other_user_id,) = _create_test_users(seeded_api_engine, 1)
    member_action_id = uuid4()
    other_action_id = uuid4()
    private_fingerprint = "b" * 64
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.add_all(
            [
                PreferenceEvent(
                    id=member_action_id,
                    user_id=MEMBER_USER_ID,
                    recipe_version_id=CARROT_ROOT_ID,
                    event_type="view",
                ),
                RecipeSave(
                    user_id=other_user_id,
                    recipe_version_id=TUNA_SALAD_ID,
                ),
                PreferenceEvent(
                    id=other_action_id,
                    user_id=other_user_id,
                    recipe_version_id=TUNA_SALAD_ID,
                    event_type="fork",
                    related_recipe_version_id=BROWN_RICE_BOWL_ID,
                    request_fingerprint=private_fingerprint,
                ),
            ]
        )

    counts_before = _table_counts(seeded_api_engine)
    normal = recommendation_client.get("/api/recommendations", params={"limit": 15})
    attempted_override = recommendation_client.get(
        "/api/recommendations",
        params={"limit": 15, "user_id": str(other_user_id)},
    )
    counts_after = _table_counts(seeded_api_engine)

    assert normal.status_code == 200
    assert attempted_override.status_code == 200
    assert normal.content == attempted_override.content
    assert counts_after == counts_before

    serialized = json.dumps(normal.json())
    for private_value in (
        str(MEMBER_USER_ID),
        str(other_user_id),
        str(member_action_id),
        str(other_action_id),
        private_fingerprint,
        f"rcp15-{other_user_id}@test.invalid",
    ):
        assert private_value not in serialized
    for private_field in (
        "user_id",
        "event_type",
        "saved_value",
        "rating_value",
        "related_recipe_version_id",
        "request_fingerprint",
        "occurred_at",
    ):
        assert f'"{private_field}"' not in serialized


@pytest.mark.parametrize("limit", ["0", "51", "many"])
def test_limit_validation_uses_the_standard_error_envelope(
    recommendation_client: TestClient,
    limit: str,
) -> None:
    response = recommendation_client.get("/api/recommendations", params={"limit": limit})

    assert response.status_code == 422
    error = _json_object(response.json())["error"]
    assert error["code"] == "validation_error"
    assert error["message"]
    assert error["issues"]


def test_missing_session_member_falls_back_to_public_cold_start(
    recommendation_client: TestClient,
    seeded_api_engine: Engine,
) -> None:
    with Session(bind=seeded_api_engine) as session, session.begin():
        session.execute(delete(User).where(User.id == MEMBER_USER_ID))

    response = recommendation_client.get("/api/recommendations")
    assert response.status_code == 200
    assert _json_object(response.json())["personalized"] is False


def test_catalog_over_in_memory_bound_uses_a_deterministic_database_shortlist(
    recommendation_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(recommendation_repository, "MAX_RECOMMENDATION_CANDIDATES", 1)

    first = recommendation_client.get("/api/recommendations")
    repeated = recommendation_client.get("/api/recommendations")

    assert first.status_code == 200
    assert first.headers["cache-control"] == "private, no-store"
    assert first.content == repeated.content
    body = _json_object(first.json())
    assert body["strategy"] == "baseline-v1"
    assert len(_items(body)) == 1


def test_openapi_documents_the_bounded_read_only_recommendation_contract(
    recommendation_client: TestClient,
) -> None:
    document = _json_object(recommendation_client.get("/openapi.json").json())
    paths = cast(dict[str, Any], document["paths"])
    schemas = cast(dict[str, Any], cast(dict[str, Any], document["components"])["schemas"])

    operation = paths["/api/recommendations"]["get"]
    assert operation["summary"] == "Research preview: get deterministic baseline rankings"
    assert operation["description"].startswith(
        "Research-preview API only; Recipe Lab has no consumer recommendation surface."
    )
    assert (
        "Every request uses aggregate activity for publicly readable recipes."
        in operation["description"]
    )
    assert (
        "Signed-in personalization additionally uses only the active member's private history"
        in (operation["description"])
    )
    assert operation["x-recipe-lab-classification"] == "research_experimental"
    assert operation["x-recipe-lab-consumer-evidence"] == ["docs/recommendations.md"]
    responses = operation["responses"]
    assert responses["200"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/RecipeRecommendationsResponse"
    )
    assert responses["422"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ErrorResponse"
    )
    assert responses["503"]["content"]["application/json"]["schema"]["$ref"].endswith(
        "/ErrorResponse"
    )
    parameters = {parameter["name"]: parameter for parameter in operation["parameters"]}
    assert set(parameters) == {"limit"}
    assert parameters["limit"]["in"] == "query"
    assert parameters["limit"]["required"] is False
    assert parameters["limit"]["schema"]["default"] == 10
    assert parameters["limit"]["schema"]["minimum"] == 1
    assert parameters["limit"]["schema"]["maximum"] == 50

    assert {
        "RecommendationWeightsResponse",
        "RecommendationScoreBreakdown",
        "RecipeRecommendationResponse",
        "RecipeRecommendationsResponse",
        "RecipeSummary",
        "ErrorResponse",
    } <= set(schemas)
    response_schema = schemas["RecipeRecommendationsResponse"]
    assert set(response_schema["required"]) == {
        "strategy",
        "personalized",
        "weights",
        "items",
    }
    item_schema = schemas["RecipeRecommendationResponse"]
    assert set(item_schema["required"]) == {"recipe", "score", "components", "reason"}
    assert item_schema["properties"]["reason"]["maxLength"] == 200
    assert not any("PreferenceEvent" in schema_name for schema_name in schemas)
