"""Deploy-reviewed public content selections for the Recipe Lab homepage."""

from uuid import UUID

from app.seeds.identifiers import seed_uuid

_DEMO_DATASET_ID = "recipe-lab-demo-v1"

# This list is intentionally editorial and globally identical for every viewer. It is
# not a popularity ranking or a personalized recommendation. These are stable recipe
# identities; a selected recipe whose current edition is hidden is omitted by the
# repository query rather than falling back to an older edition.
# The deterministic stable-identity backfill intentionally reused each catalog snapshot's
# exact version ID, so the original seed namespace remains the source of these IDs.
FEATURED_RECIPE_IDS: tuple[UUID, ...] = tuple(
    seed_uuid(_DEMO_DATASET_ID, "recipe-version", key)
    for key in (
        "banana-oat-pancakes-v1",
        "red-lentil-coconut-stew-v1",
        "lemon-herb-chickpea-quinoa-bowl-v1",
        "carrot-walnut-snack-cake-v1",
    )
)
