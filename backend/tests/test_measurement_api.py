from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from typing import cast
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from pytest import MonkeyPatch
from sqlalchemy import Engine, delete
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.api.routes import measurements as measurement_routes
from app.main import create_app
from app.models import MeasurementConversionRule, MeasurementUnit, MeasurementUnitAlias
from app.schemas.measurements import (
    MeasurementConversionRequest,
    MeasurementConversionResponse,
    MeasurementUnitSummary,
)
from app.services.measurements import PackageSizeRequiredError

TEST_SESSION = cast(Session, object())


@dataclass(frozen=True, slots=True)
class MeasurementApiCatalog:
    gram_id: UUID
    kilogram_id: UUID
    inactive_id: UUID
    count_id: UUID
    clove_id: UUID


@pytest.fixture
def measurement_client() -> Iterator[TestClient]:
    application = create_app()

    def override_session() -> Iterator[Session]:
        yield TEST_SESSION

    application.dependency_overrides[get_session] = override_session
    with TestClient(application) as client:
        yield client


@pytest.fixture
def measurement_database_client(
    migrated_engine: Engine,
) -> Iterator[tuple[TestClient, MeasurementApiCatalog]]:
    suffix = uuid4().hex[:8]
    gram = MeasurementUnit(
        key=f"api-gram-{suffix}",
        dimension="mass",
        conversion_family=f"api-mass-{suffix}",
        canonical_label=f"AAA API gram {suffix}",
        plural_label=f"AAA API grams {suffix}",
        symbol="ag",
        display_style="symbol",
        active=True,
        provenance="Reviewed API integration metadata.",
    )
    kilogram = MeasurementUnit(
        key=f"api-kilogram-{suffix}",
        dimension="mass",
        conversion_family=f"api-mass-{suffix}",
        canonical_label=f"ZZZ API kilogram {suffix}",
        plural_label=f"ZZZ API kilograms {suffix}",
        symbol="akg",
        display_style="symbol",
        active=True,
        provenance="Reviewed API integration metadata.",
    )
    inactive = MeasurementUnit(
        key=f"api-inactive-{suffix}",
        dimension="mass",
        conversion_family=f"api-inactive-{suffix}",
        canonical_label=f"Inactive API mass {suffix}",
        plural_label=f"Inactive API masses {suffix}",
        symbol="inactive",
        display_style="symbol",
        active=False,
        provenance="Retired API integration metadata.",
    )
    count = MeasurementUnit(
        key=f"api-count-{suffix}",
        dimension="count",
        conversion_family=f"api-count-{suffix}",
        canonical_label=f"API count {suffix}",
        plural_label=f"API counts {suffix}",
        symbol=None,
        display_style="hidden",
        active=True,
        provenance="Reviewed API integration metadata.",
    )
    clove = MeasurementUnit(
        key=f"api-clove-{suffix}",
        dimension="count",
        conversion_family=f"api-clove-{suffix}",
        canonical_label=f"API clove {suffix}",
        plural_label=f"API cloves {suffix}",
        symbol=None,
        display_style="word",
        active=True,
        provenance="Reviewed API integration metadata.",
    )
    units = [gram, kilogram, inactive, count, clove]
    with Session(bind=migrated_engine) as session, session.begin():
        session.add_all(units)
        session.flush()
        gram_id = gram.id
        kilogram_id = kilogram.id
        inactive_id = inactive.id
        count_id = count.id
        clove_id = clove.id
        unit_ids = [gram_id, kilogram_id, inactive_id, count_id, clove_id]
        session.add_all(
            [
                MeasurementConversionRule(
                    unit_id=gram.id,
                    base_unit_id=gram.id,
                    scale_numerator=1,
                    scale_denominator=1,
                    offset_numerator=0,
                    offset_denominator=1,
                    active=True,
                    provenance="Reviewed API identity conversion.",
                ),
                MeasurementConversionRule(
                    unit_id=kilogram.id,
                    base_unit_id=gram.id,
                    scale_numerator=1000,
                    scale_denominator=1,
                    offset_numerator=0,
                    offset_denominator=1,
                    active=True,
                    provenance="Reviewed API kilogram conversion.",
                ),
            ]
        )
    catalog = MeasurementApiCatalog(
        gram_id=gram_id,
        kilogram_id=kilogram_id,
        inactive_id=inactive_id,
        count_id=count_id,
        clove_id=clove_id,
    )
    application = create_app()

    def override_session() -> Iterator[Session]:
        with Session(bind=migrated_engine) as session:
            yield session

    application.dependency_overrides[get_session] = override_session
    try:
        with TestClient(application) as client:
            yield client, catalog
    finally:
        with Session(bind=migrated_engine) as session, session.begin():
            session.execute(
                delete(MeasurementConversionRule).where(
                    MeasurementConversionRule.unit_id.in_(unit_ids)
                )
            )
            session.execute(
                delete(MeasurementUnitAlias).where(
                    MeasurementUnitAlias.measurement_unit_id.in_(unit_ids)
                )
            )
            session.execute(delete(MeasurementUnit).where(MeasurementUnit.id.in_(unit_ids)))


def _gram() -> MeasurementUnit:
    gram = MeasurementUnit(
        id=uuid4(),
        key="test-api-gram",
        dimension="mass",
        conversion_family="test-api-mass",
        canonical_label="gram",
        plural_label="grams",
        symbol="g",
        display_style="symbol",
        active=True,
        provenance="Reviewed API-test metadata.",
    )
    gram.aliases.append(
        MeasurementUnitAlias(
            id=uuid4(),
            measurement_unit_id=gram.id,
            alias="gramme",
        )
    )
    return gram


def test_unit_catalog_returns_only_the_bounded_semantic_contract(
    measurement_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    gram = _gram()
    observed: dict[str, object] = {}

    def list_units(
        session: Session,
        *,
        semantic: str,
        limit: int,
    ) -> list[MeasurementUnit]:
        observed.update(session=session, semantic=semantic, limit=limit)
        return [gram]

    monkeypatch.setattr(measurement_routes, "list_active_measurement_units", list_units)

    response = measurement_client.get(
        "/api/measurement-units",
        params={"semantic": "ingredient_amount", "limit": 12},
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "id": str(gram.id),
                "key": "test-api-gram",
                "dimension": "mass",
                "canonical_label": "gram",
                "plural_label": "grams",
                "symbol": "g",
                "display_style": "symbol",
                "active": True,
                "aliases": ["gramme"],
                "provenance": "Reviewed API-test metadata.",
            }
        ]
    }
    assert observed == {
        "session": TEST_SESSION,
        "semantic": "ingredient_amount",
        "limit": 12,
    }


def test_conversion_route_serializes_deterministic_decimal_output(
    measurement_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    gram = _gram()
    kilogram_id = uuid4()
    source_summary = MeasurementUnitSummary(
        id=kilogram_id,
        key="kilogram",
        dimension="mass",
        canonical_label="kilogram",
        plural_label="kilograms",
        symbol="kg",
        display_style="symbol",
        active=True,
    )
    target_summary = MeasurementUnitSummary(
        id=gram.id,
        key=gram.key,
        dimension="mass",
        canonical_label=gram.canonical_label,
        plural_label=gram.plural_label,
        symbol=gram.symbol,
        display_style="symbol",
        active=True,
    )

    def convert(
        session: Session,
        payload: MeasurementConversionRequest,
    ) -> MeasurementConversionResponse:
        assert session is TEST_SESSION
        assert payload.from_unit_id == kilogram_id
        return MeasurementConversionResponse(
            semantic="ingredient_amount",
            source_value=Decimal("1.25"),
            source_unit=source_summary,
            value=Decimal("1250.000000"),
            unit=target_summary,
            display_unit="g",
            display="1250 g",
        )

    monkeypatch.setattr(measurement_routes, "convert_measurement", convert)
    response = measurement_client.post(
        "/api/measurements/convert",
        json={
            "semantic": "ingredient_amount",
            "value": "1.25",
            "from_unit_id": str(kilogram_id),
            "target_unit_id": str(gram.id),
        },
    )

    assert response.status_code == 200
    assert response.json()["value"] == "1250.000000"
    assert response.json()["display"] == "1250 g"


def test_conversion_errors_and_invalid_values_use_stable_error_envelopes(
    measurement_client: TestClient,
    monkeypatch: MonkeyPatch,
) -> None:
    def reject(
        _session: Session,
        _payload: MeasurementConversionRequest,
    ) -> MeasurementConversionResponse:
        raise PackageSizeRequiredError("A reviewed package size is required.")

    monkeypatch.setattr(measurement_routes, "convert_measurement", reject)
    unit_id = uuid4()
    rejected = measurement_client.post(
        "/api/measurements/convert",
        json={
            "semantic": "ingredient_amount",
            "value": "2",
            "from_unit_id": str(unit_id),
            "target_unit_id": str(unit_id),
        },
    )
    invalid = measurement_client.post(
        "/api/measurements/convert",
        json={
            "semantic": "ingredient_amount",
            "value": True,
            "from_unit_id": str(unit_id),
            "target_unit_id": str(unit_id),
        },
    )

    assert rejected.status_code == 422
    assert rejected.json() == {
        "error": {
            "code": "package_size_required",
            "message": "A reviewed package size is required.",
            "issues": [],
        }
    }
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "validation_error"


def test_real_catalog_filters_inactive_units_and_orders_each_dimension(
    measurement_database_client: tuple[TestClient, MeasurementApiCatalog],
) -> None:
    client, catalog = measurement_database_client
    response = client.get(
        "/api/measurement-units",
        params={"semantic": "ingredient_amount", "limit": 100},
    )

    assert response.status_code == 200
    items = response.json()["items"]
    assert str(catalog.inactive_id) not in {item["id"] for item in items}
    assert {str(catalog.gram_id), str(catalog.kilogram_id)} <= {item["id"] for item in items}
    assert all(item["dimension"] in {"mass", "volume", "count", "package"} for item in items)
    mass_labels = [item["canonical_label"] for item in items if item["dimension"] == "mass"]
    assert mass_labels == sorted(mass_labels, key=str.casefold)

    duration = client.get(
        "/api/measurement-units",
        params={"semantic": "action_duration", "limit": 100},
    )
    temperature = client.get(
        "/api/measurement-units",
        params={"semantic": "temperature", "limit": 100},
    )
    assert duration.status_code == 200
    assert duration.json()["items"]
    assert {item["dimension"] for item in duration.json()["items"]} == {"time"}
    assert temperature.status_code == 200
    assert temperature.json()["items"]
    assert {item["dimension"] for item in temperature.json()["items"]} == {"temperature"}


def test_real_conversion_and_catalog_failures_use_stable_envelopes(
    measurement_database_client: tuple[TestClient, MeasurementApiCatalog],
) -> None:
    client, catalog = measurement_database_client
    converted = client.post(
        "/api/measurements/convert",
        json={
            "semantic": "ingredient_amount",
            "value": "1.25",
            "from_unit_id": str(catalog.kilogram_id),
            "target_unit_id": str(catalog.gram_id),
        },
    )
    unknown = client.post(
        "/api/measurements/convert",
        json={
            "semantic": "ingredient_amount",
            "value": "1",
            "from_unit_id": str(uuid4()),
            "target_unit_id": str(catalog.gram_id),
        },
    )
    inactive = client.post(
        "/api/measurements/convert",
        json={
            "semantic": "ingredient_amount",
            "value": "1",
            "from_unit_id": str(catalog.inactive_id),
            "target_unit_id": str(catalog.gram_id),
        },
    )
    unsupported = client.post(
        "/api/measurements/convert",
        json={
            "semantic": "ingredient_amount",
            "value": "1",
            "from_unit_id": str(catalog.count_id),
            "target_unit_id": str(catalog.clove_id),
        },
    )
    underflow = client.post(
        "/api/measurements/convert",
        json={
            "semantic": "ingredient_amount",
            "value": "0.000500",
            "from_unit_id": str(catalog.gram_id),
            "target_unit_id": str(catalog.kilogram_id),
        },
    )
    smallest_supported = client.post(
        "/api/measurements/convert",
        json={
            "semantic": "ingredient_amount",
            "value": "0.000501",
            "from_unit_id": str(catalog.gram_id),
            "target_unit_id": str(catalog.kilogram_id),
        },
    )

    assert converted.status_code == 200
    assert converted.json()["value"] == "1250.000000"
    assert unknown.status_code == 404
    assert unknown.json()["error"]["code"] == "measurement_unit_not_found"
    assert inactive.status_code == 422
    assert inactive.json()["error"]["code"] == "measurement_unit_inactive"
    assert unsupported.status_code == 422
    assert unsupported.json()["error"]["code"] == "measurement_conversion_unsupported"
    assert underflow.status_code == 422
    assert underflow.json() == {
        "error": {
            "code": "measurement_value_out_of_range",
            "message": ("The converted value is smaller than the supported six-decimal precision."),
            "issues": [],
        }
    }
    assert smallest_supported.status_code == 200
    assert smallest_supported.json()["value"] == "0.000001"


def test_openapi_documents_measurement_catalog_and_conversion_contracts(
    measurement_client: TestClient,
) -> None:
    document = measurement_client.get("/openapi.json").json()
    paths = document["paths"]
    schemas = document["components"]["schemas"]

    assert "get" in paths["/api/measurement-units"]
    assert "post" in paths["/api/measurements/convert"]
    assert schemas["MeasurementConversionRequest"]["additionalProperties"] is False
    assert schemas["MeasurementConversionRequest"]["properties"]["semantic"] == {
        "$ref": "#/components/schemas/MeasurementSemantic"
    }
    assert schemas["MeasurementConversionResponse"]["properties"]["unit"] == {
        "$ref": "#/components/schemas/MeasurementUnitSummary"
    }
    assert schemas["MeasurementUnitCatalogItem"]["required"] == [
        "id",
        "key",
        "dimension",
        "canonical_label",
        "plural_label",
        "display_style",
        "active",
        "provenance",
    ]
