from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from threading import Lock

from fastapi import FastAPI

from app.core.config import Settings
from app.services.oidc import OIDCClient


class ApplicationResources:
    """Own shared process resources across one or more lifespan contexts."""

    def __init__(
        self,
        settings: Settings,
        *,
        oidc_client_factory: Callable[[Settings], OIDCClient] = OIDCClient,
    ) -> None:
        self._settings = settings
        self._oidc_client_factory = oidc_client_factory
        self._oidc_client: OIDCClient | None = None
        self._active_lifespans = 0
        self._lock = Lock()

    @property
    def oidc_client(self) -> OIDCClient:
        with self._lock:
            if self._oidc_client is None:
                raise RuntimeError("The application OIDC client is unavailable.")
            return self._oidc_client

    def start(self) -> None:
        with self._lock:
            if self._active_lifespans == 0:
                self._oidc_client = self._oidc_client_factory(self._settings)
            self._active_lifespans += 1

    def stop(self) -> None:
        with self._lock:
            if self._active_lifespans == 0:
                return
            self._active_lifespans -= 1
            if self._active_lifespans == 0 and self._oidc_client is not None:
                self._oidc_client.close()
                self._oidc_client = None


def application_lifespan(
    settings: Settings,
    *,
    oidc_client_factory: Callable[[Settings], OIDCClient] = OIDCClient,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    """Create the lifespan that owns resources for one FastAPI application."""

    resources = ApplicationResources(
        settings,
        oidc_client_factory=oidc_client_factory,
    )

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        resources.start()
        application.state.resources = resources
        try:
            yield
        finally:
            resources.stop()

    return lifespan
