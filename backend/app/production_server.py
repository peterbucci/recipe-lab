from __future__ import annotations

import os
from collections.abc import Mapping

import uvicorn
from pydantic import ValidationError
from starlette.types import ASGIApp


def _configuration_field_names(error: ValidationError) -> tuple[str, ...]:
    fields: set[str] = set()
    for issue in error.errors(include_input=False, include_url=False):
        location = issue.get("loc", ())
        if location:
            fields.add(str(location[0]).upper())
        else:
            fields.add("APPLICATION_CONFIGURATION")
    return tuple(sorted(fields))


def _load_backend_application() -> ASGIApp:
    try:
        from app.main import app
    except ValidationError as error:
        fields = ", ".join(_configuration_field_names(error))
        raise RuntimeError(f"Recipe Lab configuration is invalid: {fields}.") from None
    return app


def _port(environment: Mapping[str, str] = os.environ) -> int:
    try:
        port = int(environment.get("PORT", "8000"))
    except ValueError:
        raise RuntimeError("PORT must be an integer between 1 and 65535.") from None
    if not 1 <= port <= 65_535:
        raise RuntimeError("PORT must be an integer between 1 and 65535.")
    return port


def _require_production_environment(environment: Mapping[str, str]) -> None:
    if environment.get("APP_ENVIRONMENT", "").strip() != "production":
        raise RuntimeError("APP_ENVIRONMENT must be set to production for this server.")


def main(environment: Mapping[str, str] = os.environ) -> None:
    _require_production_environment(environment)
    application = _load_backend_application()
    uvicorn.run(
        application,
        host="0.0.0.0",
        port=_port(environment),
        reload=False,
        access_log=False,
    )


if __name__ == "__main__":
    main()
