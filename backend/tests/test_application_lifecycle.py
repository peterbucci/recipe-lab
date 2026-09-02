from typing import Annotated

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from app.api.dependencies import get_oidc_client
from app.application import ApplicationResources
from app.main import create_app
from app.services.oidc import OIDCClient


def test_oidc_client_is_shared_for_the_application_lifetime() -> None:
    application = create_app()

    @application.get("/__test__/oidc-client")
    def oidc_client_identity(
        client: Annotated[OIDCClient, Depends(get_oidc_client)],
    ) -> dict[str, str]:
        return {"identity": str(id(client))}

    with TestClient(application) as client:
        first = client.get("/__test__/oidc-client")
        second = client.get("/__test__/oidc-client")

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json() == second.json()
        assert str(id(application.state.resources.oidc_client)) == first.json()["identity"]

    resources: ApplicationResources = application.state.resources
    with pytest.raises(RuntimeError, match="OIDC client is unavailable"):
        _ = resources.oidc_client


def test_nested_lifespans_share_and_close_one_oidc_client() -> None:
    application = create_app()

    with TestClient(application), TestClient(application):
        resources: ApplicationResources = application.state.resources
        shared_client = resources.oidc_client
        assert resources.oidc_client is shared_client

    with pytest.raises(RuntimeError, match="OIDC client is unavailable"):
        _ = resources.oidc_client
