# Recipe model

Recipe Lab treats a published recipe as history. A cook edits a private draft. Publishing turns that draft into an immutable published version. If the cook changes the recipe later, Recipe Lab keeps the earlier version and adds another one. If another cook makes their own recipe from it, Recipe Lab records the specific published version they started from.

This document is the authoritative explanation of that lifecycle: **recipes, published versions, revisions, adaptations, drafts, publication, history, and visibility**.

For related topics:

- [Architecture](architecture.md) explains where these responsibilities live in the application.
- [Security](security.md) explains authentication, authorization, moderation, privacy, and account lifecycle rules.
- [Data model reference](reference/data-model.md) contains database-level entities, fields, constraints, and indexes.

## Core concepts

Recipe Lab separates three things that many recipe applications treat as one.

| Concept               | What it represents                                      | Mutable?                                                                          |
| --------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Recipe**            | One cook's recipe across its published history          | Its current-version relationship can advance when the author publishes a revision |
| **Published version** | One exact public snapshot of that recipe                | No                                                                                |
| **Draft**             | Private working state used to create or change a recipe | Yes, while active                                                                 |

Related recipes are also connected through their source history.

## Revisions and adaptations are different

There are two ways a published recipe can lead to another published version.

### Revision

A revision is a new published version of **the same recipe** by its author.

```text
Alice's recipe

Version 1  --->  Version 2  --->  Version 3
```

Version 1 does not become Version 2. Both remain separate immutable snapshots. The recipe's normal public destination advances to the latest published version.

### Adaptation

An adaptation is a **different recipe** based on one exact published version of another recipe.

```text
Alice's recipe                 Bob's recipe

Version 1  --->  Version 2       Version 1
    |                                ^
    +--------- based on -------------+
```

Bob's recipe remains based on Alice's Version 1 even after Alice publishes Version 2. The source relationship never silently moves forward.

That distinction is central to the model:

- a **revision** continues one recipe's own history;
- an **adaptation** starts another recipe while preserving its exact source.

## Private drafts

All authoring happens in private drafts.

A draft records one publishing intent when it is created:

| Draft type     | Starting point                         | What publishing creates                                     |
| -------------- | -------------------------------------- | ----------------------------------------------------------- |
| **Original**   | No source recipe                       | The first published version of a new recipe                 |
| **Adaptation** | One readable published version         | The first version of a separate recipe based on that source |
| **Revision**   | The author's current published version | The next published version of the same recipe               |

## Publishing

Publication is the boundary between private mutable work and public immutable history.

```text
Private draft
    |
    | validate + publish
    v
Published version
```

The frontend does not create the public recipe one piece at a time. Publication is one backend-controlled transaction.

Before committing it, the backend rechecks the information that matters to the requested transition, including:

- the member and draft;
- the expected saved draft revision;
- whether the request is an original, adaptation, or revision;
- source availability and ownership where required;
- the complete recipe document;
- structured ingredients, measurements, instructions, and actions;
- duplicate-review evidence when the publication flow requires it.

A successful publication then creates the complete immutable snapshot and the relationships needed for its history.

### Publishing an original

An original has no source recipe.

Publishing it creates:

- a new recipe;
- its first published version;
- the beginning of a new recipe history.

### Publishing an adaptation

An adaptation starts from one exact public version of another recipe.

Publishing it:

- verifies that the source version is still readable;
- creates a different recipe;
- records the exact source version;
- adds the new recipe to the same broader recipe family/history.

### Publishing a revision

A revision continues an existing recipe.

Publishing it:

- verifies that the member still owns the recipe;
- verifies that the source is still the recipe's current readable version;
- creates the next immutable version;
- advances the recipe's current version to the newly published snapshot.

The earlier version remains available as history.

## Recipe history

Recipe history needs to answer two different questions:

1. **How has this recipe changed over time?**
2. **Which other recipes were made from it?**

The model therefore keeps same-recipe revision history separate from cross-recipe adaptation history.

A useful simplified view is:

```text
Alice's recipe
  V1 ---> V2 ---> V3
   |
   +------> Bob's recipe V1 ---> V2
   |
   +------> Carol's recipe V1
```

Bob's first version remains based on Alice's V1. Bob can later revise his own recipe without changing that original source relationship.

The UI does not need to expose the entire internal graph at once. Recipe pages can show the direct relationships relevant to the current version while the backend preserves the complete history.

## Comparison

Recipe comparison is a read over two immutable published snapshots.

By default, Recipe Lab can compare a version with the version it was directly based on. Other comparisons can use another version from the same recipe family when supported by the route.

The backend computes the semantic differences in recipe metadata, ingredients, instructions, and structured cooking details. Then the browser renders that result.

## Saved recipes

A saved recipe is tied to the **exact published version the member saved**.

If the author later publishes a revision, the save does not silently move to the newer version. The application may separately show that a newer current version exists.

This is deliberate: saving a recipe preserves what the member actually chose at the time.

## Visibility

Visibility is separate from recipe content and version history.

A published version can be:

- **published** — publicly readable;
- **author withdrawn** — hidden by its author;
- **moderation hidden** — hidden through the moderation workflow.

Withdrawing or moderating a version does not rewrite the recipe snapshot.

Author withdrawal and moderation are independent. Restoring a moderation-hidden version cannot override an author's withdrawal, and an author cannot restore a version that is still hidden by moderation.

A hidden source may still have public descendants. Those descendants keep their historical relationship, but the application does not expose private or moderated source details through that relationship.

The authorization, moderation, and privacy rules behind these states are documented in [Security](security.md).

## Authorship and account deletion

Each published version keeps the identity of the member who published it.

Public profiles expose only the public account information needed for attribution. Private authentication data, sessions, saves, ratings, drafts, and other member-only state are not part of the public recipe model.

If an account is deleted, private account data is removed according to the account-lifecycle rules, but already-published recipe history remains structurally valid. Public attribution becomes a deleted-cook tombstone rather than transferring ownership or rewriting old recipe versions.

The full deletion and retention rules belong in [Security](security.md) and [Recovery reference](reference/recovery.md).
