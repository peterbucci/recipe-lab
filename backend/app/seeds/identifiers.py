from uuid import NAMESPACE_URL, UUID, uuid5

SEED_NAMESPACE = uuid5(
    NAMESPACE_URL,
    "https://github.com/peterbucci/recipe-lab/deterministic-seed-data",
)

MEASUREMENT_NAMESPACE_URL = "https://github.com/peterbucci/recipe-lab/measurement-catalog/v1"
MEASUREMENT_NAMESPACE = uuid5(NAMESPACE_URL, MEASUREMENT_NAMESPACE_URL)


def seed_uuid(dataset_id: str, entity_type: str, stable_key: str) -> UUID:
    """Return a stable UUID for one seed-owned database record."""

    return uuid5(SEED_NAMESPACE, f"{dataset_id}:{entity_type}:{stable_key}")


def measurement_uuid(entity_type: str, stable_key: str) -> UUID:
    """Return a stable UUID from the immutable measurement-catalog v1 namespace."""

    return uuid5(MEASUREMENT_NAMESPACE, f"{entity_type}:{stable_key}")
