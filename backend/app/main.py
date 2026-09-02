from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_error_handlers
from app.api.router import api_router
from app.api.routes import health
from app.application import application_lifespan
from app.core.config import settings
from app.core.logging import install_sensitive_query_redaction
from app.middleware.privacy_safe_observability import PrivacySafeObservabilityMiddleware
from app.middleware.request_body_limit import RequestBodyLimitMiddleware
from app.openapi_contract import install_openapi_contract


def create_app() -> FastAPI:
    install_sensitive_query_redaction()
    application = FastAPI(
        title="Recipe Lab API",
        summary="API for structured, forkable recipe variants.",
        version="0.1.0",
        lifespan=application_lifespan(settings),
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_middleware(
        RequestBodyLimitMiddleware,
        max_body_bytes=settings.max_request_body_bytes,
    )
    application.add_middleware(PrivacySafeObservabilityMiddleware)
    register_error_handlers(application)
    application.include_router(health.router, prefix="/api", tags=["health"])
    application.include_router(api_router, prefix="/api")
    install_openapi_contract(application)
    return application


app = create_app()
