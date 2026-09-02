from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models import (
    ACCOUNT_KIND_MEMBER,
    USER_STATUS_ACTIVE,
    PreferenceEvent,
    RecipeDraft,
    RecipeRating,
    RecipeSave,
    RecipeStructuralFingerprint,
    RecipeVersion,
    User,
)
from app.repositories.recipe_diffs import (
    get_recipe_version_diff_identity,
    get_recipe_versions_for_diff,
)
from app.repositories.recipes import (
    browse_recipe_versions,
    get_recipe_version,
    list_public_recipe_duplicate_candidates,
)
from app.repositories.recommendations import load_recommendation_data
from app.schemas.recipe_drafts import RecipeDraftUpdateRequest
from app.services.recipe_drafts import (
    create_recipe_draft,
    discard_recipe_draft,
    replace_recipe_draft,
)
from app.services.recipe_fingerprints import STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION


def _count(session: Session, model: type[Base]) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def test_private_draft_is_absent_from_every_public_and_signal_query(
    db_session: Session,
) -> None:
    """A sentinel private body must remain outside every RecipeVersion adapter."""

    unique = uuid4().hex
    author = User(
        email=f"private-draft-{unique}@example.invalid",
        display_name="Private Draft Author",
        handle=f"draft-{unique[:12]}",
        account_kind=ACCOUNT_KIND_MEMBER,
        status=USER_STATUS_ACTIVE,
    )
    db_session.add(author)
    db_session.flush()

    signal_models = (
        RecipeVersion,
        RecipeStructuralFingerprint,
        RecipeSave,
        RecipeRating,
        PreferenceEvent,
    )
    counts_before = {model: _count(db_session, model) for model in signal_models}
    recommendations_before = load_recommendation_data(db_session, author.id)

    draft = create_recipe_draft(
        db_session,
        author_user_id=author.id,
        creation_action_id=uuid4(),
        source_version_id=None,
    )
    assert draft is not None
    sentinel = f"PRIVATE DRAFT MUST NOT LEAK {unique}"
    replaced = replace_recipe_draft(
        db_session,
        author_user_id=author.id,
        draft_id=draft.id,
        payload=RecipeDraftUpdateRequest(
            revision=1,
            title=sentinel,
            description=f"Private description {unique}",
            servings=None,
            ingredients=[],
            instructions=[],
        ),
    )
    assert replaced is not None
    assert replaced.revision == 2

    browse = browse_recipe_versions(
        db_session,
        search=sentinel,
        lineage_id=None,
        ingredient_name=None,
        is_variant=None,
        offset=0,
        limit=20,
    )
    assert browse.items == []
    assert browse.total == 0
    assert get_recipe_version(db_session, draft.id) is None
    assert get_recipe_version_diff_identity(db_session, draft.id) is None
    assert get_recipe_versions_for_diff(db_session, {draft.id}) == {}
    assert (
        list_public_recipe_duplicate_candidates(
            db_session,
            algorithm_version=STRUCTURAL_FINGERPRINT_ALGORITHM_VERSION,
            subject_digest="0" * 64,
            subject_canonical_payload="{}",
            subject_ingredient_identities=(),
            comparison_limit=10,
            exact_candidate_limit=5,
        )
        == []
    )

    recommendations_after = load_recommendation_data(db_session, author.id)
    assert recommendations_after == recommendations_before
    assert all(candidate.recipe.title != sentinel for candidate in recommendations_after.candidates)
    assert {model: _count(db_session, model) for model in signal_models} == counts_before

    assert discard_recipe_draft(
        db_session,
        author_user_id=author.id,
        draft_id=draft.id,
        expected_revision=2,
    )
    discarded = db_session.get(RecipeDraft, draft.id)
    assert discarded is not None
    assert discarded.status == "discarded"
    assert discarded.title == ""
    assert discarded.description is None
    assert discarded.servings is None
    assert {model: _count(db_session, model) for model in signal_models} == counts_before
