from uuid import uuid4

import pytest

from app.core.demo_identity import DEMO_USER_DISPLAY_NAME, DEMO_USER_ID
from app.models import ACCOUNT_KIND_DEMO, ACCOUNT_KIND_MEMBER, ACCOUNT_KIND_SYSTEM, User
from app.services.recipe_responses import public_user_reference


def test_public_user_reference_preserves_handleless_demo_identity() -> None:
    demo_user = User(
        id=DEMO_USER_ID,
        email="demo-cook@recipe-lab.invalid",
        display_name="Legacy label that is not exposed",
        handle=None,
        account_kind=ACCOUNT_KIND_DEMO,
    )

    assert public_user_reference(demo_user).model_dump(mode="json") == {
        "id": str(demo_user.id),
        "handle": None,
        "display_name": DEMO_USER_DISPLAY_NAME,
    }


@pytest.mark.parametrize(
    "account_kind", [ACCOUNT_KIND_MEMBER, ACCOUNT_KIND_SYSTEM, ACCOUNT_KIND_DEMO]
)
def test_public_user_reference_rejects_other_handleless_active_users(
    account_kind: str,
) -> None:
    user = User(
        id=uuid4(),
        email="incomplete@example.test",
        display_name="Incomplete user",
        handle=None,
        account_kind=account_kind,
    )

    with pytest.raises(RuntimeError, match="does not have a public handle"):
        public_user_reference(user)
