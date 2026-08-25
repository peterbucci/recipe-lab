# Recipe Lab Demo Catalog v1

## Scope and origin

`catalog.json`, `recipes.json`, `measurements-v1.json`, and `actions-v1.json`
are the Recipe Lab demo data assets. Their
recipe titles, descriptions, quantities, instructions, ingredient metadata,
aliases, and substitution notes were written independently for this project.
They are not copied or adapted from published recipes.

The catalog metadata records the stable dataset ID `recipe-lab-demo-v1`,
version `1`, and publication timestamp `2026-08-20T00:00:00Z`. Stable keys are
part of the data contract: changing an existing recipe snapshot requires a new
recipe-version key and parent link rather than editing the published snapshot.

## License

The four data assets named above are dedicated to the public domain under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/).
This dedication applies to the catalog content, not automatically to the
Recipe Lab source code or other repository files.

## Measurement vocabulary

`measurements-v1.json` uses a dedicated UUIDv5 namespace that is independent
of the demo recipe dataset version. Existing measurement keys and identifiers
are immutable; a later vocabulary revision must use a new versioned asset
rather than reinterpret v1 keys.

The v1 conversion rules are deliberately narrow. Metric mass, metric volume,
elapsed time, and Celsius/Fahrenheit use explicit rational scale and offset
rules. Culinary teaspoon, tablespoon, and cup labels retain their authored
meaning but have no conversion rule because regional definitions differ.
Count labels and package labels such as can and bunch are likewise not treated
as interchangeable without reviewed ingredient-specific metadata.

## Cooking-action vocabulary

`actions-v1.json` uses its own immutable UUIDv5 namespace and contains both the
reviewed cooking-action vocabulary and an explicit action mapping for every
bundled instruction. The mapping was authored against the recipe and ingredient
row keys in `recipes.json`; the seed loader never extracts or guesses actions
from natural-language instruction text. Stable action-type keys and identifiers
must not be reinterpreted. A superseded type becomes inactive so historical
recipes remain readable while new recipes select only active vocabulary.

Ingredient inputs in an action mapping reference specific ingredient-row keys
from the same recipe snapshot. Optional duration and temperature parameters use
the curated units and typed quantity shapes from `measurements-v1.json`. The
mapping intentionally does not model equipment, intermediate products, or a
general cooking knowledge graph.

## Interpretation and safety

- Substitutions are curated, directed examples for product development. They
  are context-dependent and must not be treated as automatic reverse or
  transitive relationships.
- Dietary and allergen assignments record only positive demo metadata. A
  missing assignment means unknown, not suitable or allergen-free. Product
  formulation and cross-contact vary; users must check current package labels
  and seek qualified advice when needed.
- Recipe directions involving poultry or ground poultry use a finish
  temperature of 165 degrees F (74 degrees C), and the salmon recipe uses
  145 degrees F (63 degrees C). These factual safety references follow the
  [USDA FSIS safe temperature chart](https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart);
  the USDA chart is not a source for the recipe expression.
