from sqlalchemy import Engine, inspect


def test_member_activity_indexes_match_stable_private_read_order(
    migrated_engine: Engine,
) -> None:
    inspector = inspect(migrated_engine)
    publication_indexes = {
        index["name"]: index for index in inspector.get_indexes("recipe_version_publications")
    }
    request_indexes = {
        index["name"]: index for index in inspector.get_indexes("ingredient_catalog_requests")
    }

    assert publication_indexes["ix_recipe_version_publications_actor_published"][
        "column_names"
    ] == ["actor_user_id", "published_at", "recipe_version_id"]
    reviewed = request_indexes["ix_ingredient_catalog_requests_requester_reviewed_id"]
    assert reviewed["column_names"] == ["requester_user_id", "reviewed_at", "id"]
    assert "reviewed_at IS NOT NULL" in str(
        reviewed.get("dialect_options", {}).get("postgresql_where", "")
    )
