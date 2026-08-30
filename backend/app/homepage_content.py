"""Deploy-reviewed public content selections for the Recipe Lab homepage."""

from uuid import UUID

from app.seeds.identifiers import seed_uuid

_DEMO_DATASET_ID = "recipe-lab-demo-v1"

# This list is intentionally editorial and globally identical for every viewer. It is
# not a popularity ranking or a personalized recommendation. A selected recipe that is
# no longer public is omitted by the repository query rather than leaked from this list.
FEATURED_RECIPE_VERSION_IDS: tuple[UUID, ...] = tuple(
    seed_uuid(_DEMO_DATASET_ID, "recipe-version", key)
    for key in (
        "banana-oat-pancakes-v1",
        "red-lentil-coconut-stew-v1",
        "lemon-herb-chickpea-quinoa-bowl-v1",
        "carrot-walnut-snack-cake-v1",
    )
)
