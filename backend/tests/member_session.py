from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.core.security import (
    AUTH_CSRF_COOKIE_NAME,
    AUTH_SESSION_COOKIE_NAME,
    generate_opaque_token,
    token_digest,
)
from app.models import ACCOUNT_KIND_MEMBER, USER_STATUS_ACTIVE, User, UserSession
from app.services.auth import utc_now

TEST_BROWSER_ORIGIN = "http://localhost:3000"


@dataclass(frozen=True, slots=True)
class MemberCredentials:
    user_id: UUID
    session_token: str
    csrf_token: str


def create_member_credentials(
    engine: Engine,
    *,
    user_id: UUID,
    handle: str | None = "test_member",
    display_name: str = "RCP-24 Test Member",
) -> MemberCredentials:
    now = utc_now()
    session_token = generate_opaque_token()
    csrf_token = generate_opaque_token()
    with Session(bind=engine) as session, session.begin():
        session.add(
            User(
                id=user_id,
                email=f"{user_id}@test.invalid",
                display_name=display_name,
                handle=handle,
                account_kind=ACCOUNT_KIND_MEMBER,
                status=USER_STATUS_ACTIVE,
            )
        )
        session.flush()
        session.add(
            UserSession(
                user_id=user_id,
                token_digest=token_digest(session_token),
                csrf_token_digest=token_digest(csrf_token),
                expires_at=now + timedelta(hours=1),
                last_seen_at=now,
            )
        )
    return MemberCredentials(
        user_id=user_id,
        session_token=session_token,
        csrf_token=csrf_token,
    )


def authenticate_client(client: TestClient, credentials: MemberCredentials) -> None:
    client.cookies.set(AUTH_SESSION_COOKIE_NAME, credentials.session_token)
    client.cookies.set(AUTH_CSRF_COOKIE_NAME, credentials.csrf_token)
    client.headers.update(
        {
            "Origin": TEST_BROWSER_ORIGIN,
            "X-CSRF-Token": credentials.csrf_token,
        }
    )
