from typing import Annotated

from fastapi import APIRouter, Body, Query

from app.api.dependencies import SessionDependency
from app.api.errors import ApiError
from app.repositories.measurements import list_active_measurement_units
from app.schemas.errors import ErrorResponse
from app.schemas.measurements import (
    MeasurementConversionRequest,
    MeasurementConversionResponse,
    MeasurementSemantic,
    MeasurementUnitCatalogPage,
)
from app.services.measurements import (
    MeasurementError,
    convert_measurement,
    measurement_unit_catalog_item,
)

router = APIRouter()

MEASUREMENT_ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    404: {
        "model": ErrorResponse,
        "description": "A requested curated unit or package-size record does not exist.",
    },
    422: {
        "model": ErrorResponse,
        "description": ("The measure is invalid or no reviewed conversion metadata supports it."),
    },
}


@router.get(
    "/measurement-units",
    response_model=MeasurementUnitCatalogPage,
    responses={422: MEASUREMENT_ERROR_RESPONSES[422]},
    summary="List active curated measurement units",
    description=(
        "Returns only active units valid for the requested semantic context. Historical "
        "inactive units remain readable through stored recipe snapshots but are never "
        "offered for new measures."
    ),
)
def measurement_unit_catalog(
    session: SessionDependency,
    semantic: Annotated[MeasurementSemantic, Query()],
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
) -> MeasurementUnitCatalogPage:
    units = list_active_measurement_units(
        session,
        semantic=semantic,
        limit=limit,
    )
    return MeasurementUnitCatalogPage(items=[measurement_unit_catalog_item(unit) for unit in units])


@router.post(
    "/measurements/convert",
    response_model=MeasurementConversionResponse,
    responses=MEASUREMENT_ERROR_RESPONSES,
    summary="Convert a structured numeric measure",
    description=(
        "Uses only active reviewed rational conversion, ingredient-density, and exact "
        "package-size metadata. It never infers count, density, or package equivalence."
    ),
)
def measurement_conversion(
    payload: Annotated[MeasurementConversionRequest, Body()],
    session: SessionDependency,
) -> MeasurementConversionResponse:
    try:
        return convert_measurement(session, payload)
    except MeasurementError as error:
        raise ApiError(
            status_code=error.status_code,
            code=error.code,
            message=str(error),
        ) from error
