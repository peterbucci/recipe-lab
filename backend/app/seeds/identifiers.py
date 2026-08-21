from uuid import NAMESPACE_URL, UUID, uuid5

SEED_NAMESPACE = uuid5(
    NAMESPACE_URL,
    "https://github.com/peterbucci/recipe-lab/deterministic-seed-data",
)


def seed_uuid(dataset_id: str, entity_type: str, stable_key: str) -> UUID:
    """Return a stable UUID for one seed-owned database record."""

    return uuid5(SEED_NAMESPACE, f"{dataset_id}:{entity_type}:{stable_key}")
