# Data Model Reference

This document is a compact reference for Recipe Lab's persistent data model.

It is meant for developers reading SQLAlchemy models, migrations, repositories, or database failures. For the product meaning of drafts, revisions, adaptations, and published history, see [Recipe lifecycle](../recipe-model.md). For ingredient identities, measures, and structured cooking actions, see [Published recipe content](#published-recipe-content).

This reference names the important domain entities and fields rather than reproducing every database column.

## Model overview

At a high level, Recipe Lab stores six kinds of data:

```text
accounts and authentication
        │
        ├── private drafts
        │
        ├── published recipe history
        │       ├── structured recipe content
        │       └── publication / visibility evidence
        │
        ├── member interactions and follows
        │
        ├── catalog and curation data
        │
        └── reports, moderation, and audit evidence
```

Published recipe history and private authoring are deliberately separate aggregates.

## Accounts and authentication

### User

`User` is the stable Recipe Lab account identity referenced by product data.

Important responsibilities include:

- public authorship;
- account lifecycle state;
- handle and display-name ownership; and
- the retained tombstone used when a deleted account still has published history.

Important constraints include:

- supported account kinds and lifecycle states;
- normalized/validated handles;
- bounded public profile text; and
- a constrained deleted-account shape.

A deleted member keeps only the minimum identity needed by retained public history. Private authentication and member data are removed separately.

### OIDCIdentity

Binds a Recipe Lab user to an external OpenID Connect identity.

The durable identity is the provider's:

```text
issuer + subject
```

Email is not the identity key.

A user may therefore retain the same Recipe Lab account even if an email address changes at the provider, subject to the authentication workflow's normal validation rules.

### UserSession

Represents one Recipe Lab application session.

The browser receives an opaque session token; the database stores its digest rather than the raw token.

Session state includes expiration/revocation information used by the authentication workflow.

### OIDCLoginTransaction

Stores short-lived state needed to complete an OIDC authorization flow, including PKCE/nonce and return-path binding.

These rows are workflow state, not member profile data.

### CatalogCurator / CommunityModerator

Curator and moderator authority are separate explicit grants.

They are not inferred from:

- account type;
- email;
- handle;
- signup order; or
- frontend route access.

The two grants intentionally remain independent.

---

## Recipe identity and published history

Recipe Lab distinguishes lineage, one cook's stable recipe, and one exact published snapshot.

```text
RecipeLineage
    │
    ├── Recipe A
    │     ├── Version A1
    │     └── Version A2
    │
    └── Recipe B
          └── Version B1
                source: A1
```

### RecipeLineage

Groups one original recipe and the separate recipes adapted from it.

A lineage is structural history. Ordinary product operations do not move published recipes between lineages.

### Recipe

Represents one cook's stable recipe identity across successive published versions.

Important relationships include:

- owning author;
- lineage;
- current published version; and
- all versions belonging to that recipe.

The current-version pointer is explicit. Reads do not infer "current" by selecting an arbitrary maximum timestamp or version number.

### RecipeVersion

Represents one exact immutable published snapshot.

Important relationships and fields include:

- stable recipe;
- lineage;
- publishing author;
- exact adaptation source through `parent_version_id`, when present;
- immediate prior version of the same recipe through `previous_recipe_version_id`, when present;
- recipe-local edition order;
- older lineage-wide `version_number` topology;
- categories;
- ingredients;
- instructions and structured actions;
- fingerprint;
- publication/visibility state; and
- member interactions.

Two relationships must not be confused:

```text
parent_version_id
    cross-recipe adaptation source

previous_recipe_version_id
    previous published version of the same stable recipe
```

Publishing a later version of a source recipe never changes an adaptation's recorded parent.

Published recipe content is immutable under ordinary product operations.

### Current-version relationship

`Recipe.current_recipe_version_id` selects the normal current version of one stable recipe.

The pointer must refer to the appropriate version of that recipe and follows the recipe's local publication order.

Exact-version URLs and foreign keys remain pinned to the exact snapshot and are not rewritten when current advances.

---

## Private drafts

### RecipeDraft

Represents one private mutable authoring aggregate owned by one member.

A draft has one creation intent:

- `original`;
- `adaptation`; or
- `revision`.

Important fields/relationships include:

- author;
- source version when the intent requires one;
- optimistic `revision`;
- lifecycle `status`;
- creation action/idempotency binding;
- draft categories;
- draft ingredients;
- draft instructions; and
- draft structured actions.

`revision` and `status` are independent:

```text
revision
    optimistic concurrency version

status
    active / published / discarded lifecycle
```

Owner identity comes from the authenticated session rather than request data.

Draft rows and all of their child rows are private.

### Draft terminal shells

A published or discarded draft may retain a minimal content-free row needed to preserve creation/publication retry semantics.

That retained shell is not editable draft content and is not listed as active work.

Unpublished draft content is removed during account deletion.

---

## Recipe categories

### RecipeCategory

Represents one curated recipe category.

Recipe versions and drafts use association rows rather than free-form category text.

Category identity remains stable even if display metadata changes.

Published category associations are part of the immutable published snapshot.

---

## Ingredient catalog

### Ingredient

Stable curated identity for one ingredient.

Published recipes reference this identity rather than trusting arbitrary ingredient text.

An ingredient can be deactivated for new authoring while remaining available to historical published versions.

### IngredientAlias

Reviewed alternate name for an ingredient.

Aliases are catalog data, not recipe-local free text.

### IngredientCatalogName

Provides the normalized shared namespace used by canonical names and aliases.

It prevents two catalog records from independently claiming the same normalized identity.

Normalization is used to detect collisions; it does not itself create or resolve an ingredient.

### IngredientCategory / DietaryFlag / Allergen

Data-backed catalog metadata.

Missing metadata means unknown and must not be interpreted as a safety guarantee.

### IngredientSubstitution

Represents one curated directed substitution relationship.

A substitution does not automatically imply:

- a reverse relationship;
- transitive substitutions;
- allergen safety; or
- nutritional equivalence.

---

## Ingredient requests and curation

### IngredientCatalogRequest

Stores a member request for an ingredient that is not currently available in the curated catalog.

The proposed text remains separate from trusted catalog identities.

Typical lifecycle:

```text
pending
  ├── approved
  ├── duplicate
  └── rejected
```

A terminal approved/duplicate result can point to a trusted catalog ingredient, but it does not rewrite private drafts automatically.

### Catalog audit evidence

Catalog decisions retain bounded evidence about:

- request;
- curator;
- terminal decision;
- resolved ingredient, where applicable;
- reason; and
- time.

Catalog decision and resulting catalog writes commit together.

---

## Measurement catalog

### MeasurementUnit

Stable curated unit identity used by ingredient measures and structured action parameters.

Important metadata includes:

- stable key;
- display information;
- dimension;
- conversion family; and
- active/inactive state.

Historical recipes can continue to reference a unit that is no longer available for new authoring.

### Unit aliases and conversion rules

The measurement model also includes reviewed aliases and explicit conversion relationships.

Conversion is stored only when Recipe Lab has an explicit rule. It does not infer arbitrary equivalence between measurement families.

### Ingredient density / package-size rules

Ingredient-specific rules support conversions that cannot be determined from units alone.

Density and package information are explicit catalog records rather than guesses.

---

## Published recipe content

Published content is stored as an ordered immutable graph beneath `RecipeVersion`.

### RecipeIngredient

One ingredient occurrence in one published version.

It stores:

- reference to the curated ingredient;
- preserved selected/display label where required;
- order;
- structured amount;
- unit/package identity when applicable; and
- immutable snapshot context.

An occurrence is distinct from the global `Ingredient` identity.

The same catalog ingredient can appear in more than one occurrence where the recipe structure requires distinct slots.

### RecipeInstruction

One ordered instruction in one published version.

Stores human-readable title/prose and owns zero or more structured actions for historical data, with stricter requirements for new publication.

### RecipeInstructionAction

One structured cooking action attached to an instruction.

References a curated `CookingActionType` and has stable order within the instruction.

### RecipeInstructionActionInput

Connects an action to a specific ingredient occurrence in the same recipe version.

Composite constraints prevent an action from referencing an ingredient occurrence from another recipe version.

One action cannot reference the same occurrence twice.

### RecipeInstructionActionMeasure

Stores structured duration or temperature parameters attached to an action.

These measures reuse the measurement catalog but allow only the shapes appropriate to the action parameter.

---

## Draft recipe content

Draft content mirrors the published graph with separate draft-owned rows.

The important distinction is ownership:

```text
draft child rows
    mutable and private

published child rows
    immutable and public/visibility-controlled
```

Draft action inputs are constrained to ingredient occurrences from the same draft.

Publication creates fresh immutable row identities and remaps internal references into the new published graph.

The draft rows themselves do not become public rows.

---

## Cooking-action catalog

### CookingActionType

Curated identity for a structured cooking action such as a reviewed verb/action type.

The catalog controls what can be selected for new authoring.

Deactivation prevents new use without reinterpreting historical published versions.

Free-form instruction prose remains separate from this identity.

---

## Publication and visibility

### RecipeVersionPublication

Stores publication and current visibility state for an exact recipe version.

Visibility is separate from immutable content.

The effective public states are:

- `published`;
- `author_withdrawn`; and
- `moderation_hidden`.

Author withdrawal and moderation hiding are independent axes.

Restoring moderation does not erase an author's withdrawal, and author actions cannot bypass active moderation.

### RecipeVersionVisibilityEvent

Append-only evidence for visibility transitions.

The event history records changes without modifying the underlying recipe snapshot.

### Publication receipt/evidence

Successful publication retains the immutable evidence needed to resolve an exact retry and prove what was published.

Publication state is tied to the exact draft revision and request identity that produced the version.

---

## Structural fingerprints and similarity review

### RecipeStructuralFingerprint

Stores the versioned canonical structural fingerprint for a published recipe version.

Important data includes:

- fingerprint algorithm/version;
- canonical payload; and
- digest.

Fingerprints support exact structural comparison and bounded similarity workflows; they are not authorship or originality claims.

### RecipeDuplicatePreflight

Stores one revision-bound pre-publication similarity review.

### RecipeDuplicateCandidate

Stores the candidate evidence returned for that preflight.

### RecipeDuplicateDecision

Stores the member's required continue decision when the review result requires acknowledgement.

The preflight, candidate evidence, and decision are tied to the exact draft revision/fingerprint and are revalidated during publication.

---

## Saves, ratings, views, and adaptations

Recipe Lab distinguishes current member state from append-only behavioral evidence.

### RecipeSave

Materialized current save state for one member and one exact recipe version.

Saved recipes remain pinned to the version the member saved even if that recipe later has a newer current version.

### RecipeRating

Materialized current rating for one member and one exact recipe version.

### PreferenceEvent

Append-only interaction evidence used for history/recommendation research.

Supported event families include:

- view;
- save;
- rating; and
- adaptation/fork.

An adaptation event links its source version to the newly published related version.

Current save/rating rows answer "what is the member's state now"; events make it possible to reconstruct bounded historical behavior.

---

## Follows and community activity

### UserFollow

Represents a directed follow from one user to another.

The pair is unique, and a user cannot follow themself.

Following does not grant access to drafts, private interactions, or account data.

Community activity is derived from public activity by followed cooks rather than stored as a second copy of those recipe publications.

---

## Reports and moderation

### RecipeReport

Private member report about an exact recipe version.

A report's private text is not part of the public recipe model.

### RecipeModerationCase

Aggregates the moderation state for a reported recipe version.

The case lifecycle is independent from immutable recipe content.

### RecipeModerationAuditEvent

Append-only evidence of moderator actions.

Moderation may change effective visibility, but it does not rewrite the published recipe snapshot.

### CommunityModerator

Separate live authorization grant required for moderation operations.

---

## Account deletion and retained references

Account deletion intentionally distinguishes private account data from public history.

Deleted accounts lose data such as:

- OIDC identity mappings;
- active sessions;
- private drafts;
- private interactions;
- follows;
- staff grants; and
- other private workflow state subject to the deletion policy.

Published recipe history can remain.

When retained public rows still require an author foreign key, the `User` row becomes the constrained `Deleted cook` tombstone rather than retaining the member's former private identity.

Recovery tooling also tracks deletion evidence needed to keep an older database restore from re-exposing data that had already been deleted.

See [Security](../security.md) and [Recovery](recovery.md) for the lifecycle and restore rules.

---

## Relationship summary

The core relationships can be reduced to:

```text
User
 ├── OIDCIdentity
 ├── UserSession
 ├── Recipe
 │    └── RecipeVersion
 │         ├── RecipeIngredient
 │         ├── RecipeInstruction
 │         │    └── RecipeInstructionAction
 │         │         ├── RecipeInstructionActionInput
 │         │         └── RecipeInstructionActionMeasure
 │         ├── RecipeVersionPublication
 │         ├── RecipeStructuralFingerprint
 │         ├── RecipeSave
 │         ├── RecipeRating
 │         └── RecipeReport
 ├── RecipeDraft
 │    └── draft-owned ingredient / instruction / action graph
 ├── PreferenceEvent
 └── UserFollow

RecipeLineage
 └── Recipe
      └── RecipeVersion
           ├── previous version of same Recipe
           └── optional exact parent version from another Recipe

Ingredient
 ├── IngredientAlias
 ├── catalog namespace entries
 ├── package / density metadata
 ├── substitutions
 └── RecipeIngredient occurrences

MeasurementUnit
 ├── aliases / conversion rules
 ├── RecipeIngredient measures
 └── action duration / temperature measures
```

---

## Constraints worth knowing

These are the constraints most likely to matter when debugging a failed write or migration.

### Ownership and privacy

- Draft reads and writes are owner-scoped.
- Draft child rows belong to one draft.
- Structured action inputs cannot cross draft/version boundaries.
- Staff authority comes from explicit live grants.

### Recipe history

- Published versions do not change content through ordinary product operations.
- A version belongs to its stable recipe and lineage.
- Adaptation and same-recipe succession use different relationships.
- Current version is explicit.
- Published topology cannot form arbitrary cycles.

### Ordered structures

The database preserves stable order for:

- recipe ingredients;
- instructions;
- actions; and
- action inputs.

Ordering is part of the recipe snapshot.

### Catalog integrity

- Canonical ingredient names and aliases share one collision-safe namespace.
- Published ingredient references are restrictive.
- Inactive catalog records remain readable historically.
- Curated measurement/action identities are required for new structured authoring.

### Interaction state

- Save/rating materialized state is unique per member/version.
- Follows are unique per follower/followed pair.
- Self-follow is invalid.
- Important mutation identities cannot be reused for changed intent.

### Audit/evidence

Visibility, moderation, duplicate-review, and other protected evidence is append-only or otherwise constrained against ordinary rewriting.

Privacy-required cleanup is handled through the specific account lifecycle/recovery rules rather than ordinary product mutation.

---

## Source of truth

The SQLAlchemy models and Alembic migrations are the executable schema authority.

This document is intentionally a guide to the shape of that schema, not a duplicate schema definition. When a column, constraint, index, or historical migration detail matters, inspect:

```text
backend/app/models/
backend/migrations/
```

A model refactor should update this document only when it changes a concept or relationship a developer needs to understand—not for every internal column rename.
