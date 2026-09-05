"use client";

import { useMemo, useRef, useState } from "react";

import type {
  RecipeCardSummary,
  RecipeDetail,
  RecipeVersionReference,
} from "../../lib/recipe-api";
import { GuardedLink } from "./navigation-blocker-provider";
import { RecipeArtwork } from "./recipe-artwork";

interface RecipeFamilyNavigatorProps {
  draftPreview?: RecipeFamilyDraftPreview;
  recipe: RecipeDetail;
  versions?: readonly RecipeCardSummary[];
}

export interface RecipeFamilyDraftPreview {
  authorDisplayName: string;
  id: string;
  parentVersionId: string;
  title: string;
}

interface FamilyNode {
  authorDisplayName: string;
  id: string;
  kind: "draft" | "published";
  parentVersionId: string | null;
  saveCount: number;
  title: string;
  versionNumber: number;
}

function nodeFromReference(
  version: RecipeVersionReference,
  parentVersionId: string | null,
): FamilyNode {
  return {
    authorDisplayName: version.author.display_name,
    id: version.id,
    kind: "published",
    parentVersionId,
    saveCount: 0,
    title: version.title,
    versionNumber: version.version_number,
  };
}

function nodeFromSummary(version: RecipeCardSummary): FamilyNode {
  return {
    authorDisplayName: version.author.display_name,
    id: version.id,
    kind: "published",
    parentVersionId: version.parent_version_id,
    saveCount: version.save_count,
    title: version.title,
    versionNumber: version.version_number,
  };
}

function nodeFromDraft(preview: RecipeFamilyDraftPreview): FamilyNode {
  return {
    authorDisplayName: preview.authorDisplayName,
    id: preview.id,
    kind: "draft",
    parentVersionId: preview.parentVersionId,
    saveCount: 0,
    title: preview.title,
    versionNumber: Number.MAX_SAFE_INTEGER,
  };
}

function saveCountLabel(saveCount: number): string {
  return `${saveCount.toLocaleString("en-US")} ${saveCount === 1 ? "save" : "saves"}`;
}

function versionMeta(node: FamilyNode): string {
  if (node.kind === "draft") return "Would become a version";
  return node.parentVersionId === null
    ? "Original recipe"
    : `Version ${node.versionNumber}`;
}

function FamilyNodeMeta({ node }: { node: FamilyNode }) {
  return (
    <span className="recipe-family-nav__node-meta">
      <span>{versionMeta(node)}</span>
      <span>
        {node.kind === "draft"
          ? "Not published"
          : saveCountLabel(node.saveCount)}
      </span>
    </span>
  );
}

function FamilyNeighborCard({
  currentRecipeId,
  label,
  node,
  onSelect,
}: {
  currentRecipeId: string | null;
  label: string;
  node: FamilyNode;
  onSelect: (id: string) => void;
}) {
  return (
    <article
      className={`recipe-family-nav__neighbor-card${node.kind === "draft" ? " recipe-family-nav__neighbor-card--draft" : ""}`}
      aria-current={node.kind === "draft" ? "page" : undefined}
    >
      <button
        className="recipe-family-nav__card-selector"
        type="button"
        aria-label={
          node.kind === "draft"
            ? `Show current draft ${node.title} in the family tree`
            : `Show ${node.title} in the family tree`
        }
        onClick={() => onSelect(node.id)}
      />
      <RecipeArtwork
        className="recipe-family-nav__artwork"
        recipeKey={node.id}
      />
      <span className="recipe-family-nav__neighbor-copy">
        <span className="recipe-family-nav__node-type">
          {node.kind === "draft" ? "Current draft" : label}
        </span>
        {node.kind === "draft" ? (
          <strong className="recipe-family-nav__draft-title">
            {node.title}
          </strong>
        ) : (
          <GuardedLink
            className="recipe-family-nav__title-link"
            href={`/recipes/${encodeURIComponent(node.id)}`}
            aria-current={node.id === currentRecipeId ? "page" : undefined}
          >
            {node.title}
          </GuardedLink>
        )}
        <span className="recipe-family-nav__author">
          By {node.authorDisplayName}
        </span>
        <FamilyNodeMeta node={node} />
      </span>
    </article>
  );
}

function buildFamilyNodes(
  recipe: RecipeDetail,
  versions: readonly RecipeCardSummary[],
): Map<string, FamilyNode> {
  const nodes = new Map(
    versions.map((version) => [version.id, nodeFromSummary(version)]),
  );

  nodes.set(recipe.id, {
    authorDisplayName: recipe.author.display_name,
    id: recipe.id,
    kind: "published",
    parentVersionId: recipe.parent_version_id,
    saveCount: recipe.save_count,
    title: recipe.title,
    versionNumber: recipe.version_number,
  });

  if (recipe.parent && !nodes.has(recipe.parent.id)) {
    nodes.set(
      recipe.parent.id,
      nodeFromReference(
        recipe.parent,
        recipe.parent.version_number === 1
          ? null
          : `unavailable-parent:${recipe.parent.id}`,
      ),
    );
  }

  for (const child of recipe.children) {
    if (!nodes.has(child.id)) {
      nodes.set(child.id, nodeFromReference(child, recipe.id));
    }
  }

  return nodes;
}

function sortedNodes(nodes: Iterable<FamilyNode>): FamilyNode[] {
  return [...nodes].sort(
    (left, right) =>
      left.versionNumber - right.versionNumber ||
      left.title.localeCompare(right.title),
  );
}

export function RecipeFamilyNavigator({
  draftPreview,
  recipe,
  versions = [],
}: RecipeFamilyNavigatorProps) {
  const publishedNodes = useMemo(
    () => buildFamilyNodes(recipe, versions),
    [recipe, versions],
  );
  const nodes = useMemo(() => {
    const familyNodes = new Map(publishedNodes);
    if (draftPreview) {
      familyNodes.set(draftPreview.id, nodeFromDraft(draftPreview));
    }
    return familyNodes;
  }, [draftPreview, publishedNodes]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const selectionScope = `${recipe.id}:${draftPreview?.id ?? ""}`;
  const initialFocusedId = draftPreview?.id ?? recipe.id;
  const [selection, setSelection] = useState({
    scope: selectionScope,
    focusedId: initialFocusedId,
  });
  const focusedId =
    selection.scope === selectionScope && nodes.has(selection.focusedId)
      ? selection.focusedId
      : initialFocusedId;
  const currentRecipeId = draftPreview ? null : recipe.id;

  const focused = nodes.get(focusedId) ?? nodes.get(recipe.id)!;
  const parent = focused.parentVersionId
    ? (nodes.get(focused.parentVersionId) ?? null)
    : null;
  const parentUnavailable = focused.parentVersionId !== null && parent === null;
  const children = sortedNodes(
    [...nodes.values()].filter(
      (candidate) => candidate.parentVersionId === focused.id,
    ),
  );
  const visibleChildrenCount = children.length;
  const siblings = parent
    ? sortedNodes(
        [...nodes.values()].filter(
          (candidate) => candidate.parentVersionId === parent.id,
        ),
      )
    : [];
  const siblingIndex = siblings.findIndex(
    (candidate) => candidate.id === focused.id,
  );
  const previousSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
  const nextSibling =
    siblingIndex >= 0 && siblingIndex < siblings.length - 1
      ? siblings[siblingIndex + 1]
      : null;

  let familyOrigin = focused;
  let generationDepth = 0;
  const visited = new Set<string>([focused.id]);
  while (
    familyOrigin.parentVersionId &&
    nodes.has(familyOrigin.parentVersionId) &&
    !visited.has(familyOrigin.parentVersionId)
  ) {
    familyOrigin = nodes.get(familyOrigin.parentVersionId)!;
    visited.add(familyOrigin.id);
    generationDepth += 1;
  }

  const originIsKnown = familyOrigin.parentVersionId === null;
  const showOrigin =
    originIsKnown &&
    familyOrigin.id !== focused.id &&
    familyOrigin.id !== parent?.id;
  const positionLabel =
    focused.kind === "draft"
      ? "Current draft"
      : focused.parentVersionId === null
        ? "Original recipe"
        : `Generation ${generationDepth + 1} · Version ${focused.versionNumber}`;
  const selectedNodeLabel = `${
    focused.kind === "draft"
      ? "Selected current draft"
      : "Selected family recipe"
  }: ${focused.title}`;

  function selectNode(id: string) {
    if (!nodes.has(id) || id === focused.id) return;
    setSelection({ scope: selectionScope, focusedId: id });
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }

  return (
    <section
      id="recipe-family"
      className="recipe-family-nav"
      aria-labelledby="recipe-family-heading"
    >
      <div className="recipe-family-nav__heading">
        <div>
          <h2 id="recipe-family-heading" ref={headingRef} tabIndex={-1}>
            Recipe family
          </h2>
          <p>
            Select a card to recenter the tree. Select a recipe name to open its
            full recipe page.
          </p>
        </div>
        <span className="recipe-family-nav__position">{positionLabel}</span>
      </div>

      {showOrigin ? (
        <>
          <div className="recipe-family-nav__origin">
            <div className="recipe-family-nav__anchor-label">Family origin</div>
            <article className="recipe-family-nav__origin-card">
              <button
                className="recipe-family-nav__card-selector"
                type="button"
                aria-label={`Show ${familyOrigin.title} in the family tree`}
                onClick={() => selectNode(familyOrigin.id)}
              />
              <RecipeArtwork
                className="recipe-family-nav__origin-artwork"
                recipeKey={familyOrigin.id}
              />
              <div className="recipe-family-nav__origin-copy">
                <span className="recipe-family-nav__node-type">
                  Original recipe
                </span>
                <h3>
                  <GuardedLink
                    className="recipe-family-nav__title-link"
                    href={`/recipes/${encodeURIComponent(familyOrigin.id)}`}
                    aria-current={
                      familyOrigin.id === currentRecipeId ? "page" : undefined
                    }
                  >
                    {familyOrigin.title}
                  </GuardedLink>
                </h3>
                <p>By {familyOrigin.authorDisplayName}</p>
                <span className="recipe-family-nav__node-meta">
                  <span>Family origin</span>
                  <span>{publishedNodes.size} versions</span>
                </span>
              </div>
            </article>
          </div>
          <div className="recipe-family-nav__path-hint">
            {generationDepth}{" "}
            {generationDepth === 1 ? "generation" : "generations"}
            {" between the original and the selected recipe"}
          </div>
        </>
      ) : null}

      <div className="recipe-family-nav__focus-shell">
        {parent ? (
          <div className="recipe-family-nav__parent-area">
            <div className="recipe-family-nav__parent-card">
              <FamilyNeighborCard
                currentRecipeId={currentRecipeId}
                label="Parent"
                node={parent}
                onSelect={selectNode}
              />
            </div>
          </div>
        ) : parentUnavailable ? (
          <div className="recipe-family-nav__parent-area">
            <article className="recipe-family-nav__unavailable-parent">
              <span className="recipe-family-nav__node-type">Parent</span>
              <h3>Source unavailable</h3>
            </article>
          </div>
        ) : null}

        {parent || parentUnavailable ? (
          <div className="recipe-family-nav__relationship-divider recipe-family-nav__parent-divider">
            <span>Parent ↑</span>
          </div>
        ) : null}

        <div className="recipe-family-nav__focus-row">
          <div
            className={`recipe-family-nav__sibling-slot${previousSibling ? "" : " recipe-family-nav__sibling-slot--empty"}`}
          >
            {previousSibling ? (
              <FamilyNeighborCard
                currentRecipeId={currentRecipeId}
                label="Previous sibling"
                node={previousSibling}
                onSelect={selectNode}
              />
            ) : null}
          </div>

          <article
            className={`recipe-family-nav__current-card${
              focused.kind === "draft"
                ? " recipe-family-nav__current-card--draft"
                : ""
            }`}
            aria-current={focused.kind === "draft" ? "page" : undefined}
            aria-label={selectedNodeLabel}
          >
            <RecipeArtwork
              className="recipe-family-nav__current-artwork"
              recipeKey={focused.id}
            />
            <div className="recipe-family-nav__current-copy">
              <div className="recipe-family-nav__current-topline">
                <span className="recipe-family-nav__node-type">
                  {focused.kind === "draft" ? "Current draft" : "Version"}
                </span>
                <span className="recipe-family-nav__current-badge">
                  Selected
                </span>
              </div>
              <h3>
                {focused.kind === "draft" ? (
                  focused.title
                ) : (
                  <GuardedLink
                    className="recipe-family-nav__title-link"
                    href={`/recipes/${encodeURIComponent(focused.id)}`}
                    aria-current={
                      focused.id === currentRecipeId ? "page" : undefined
                    }
                  >
                    {focused.title}
                  </GuardedLink>
                )}
              </h3>
              <p>By {focused.authorDisplayName}</p>
              <FamilyNodeMeta node={focused} />
              {focused.kind === "published" && focused.id !== recipe.id ? (
                <GuardedLink
                  className="recipe-family-nav__change-link"
                  href={`/recipes/${encodeURIComponent(focused.id)}/compare?base_version_id=${encodeURIComponent(recipe.id)}`}
                >
                  Compare with {recipe.title} →
                </GuardedLink>
              ) : null}
            </div>
          </article>

          <div
            className={`recipe-family-nav__sibling-slot${nextSibling ? "" : " recipe-family-nav__sibling-slot--empty"}`}
          >
            {nextSibling ? (
              <FamilyNeighborCard
                currentRecipeId={currentRecipeId}
                label="Next sibling"
                node={nextSibling}
                onSelect={selectNode}
              />
            ) : null}
          </div>
        </div>

        <div
          className="recipe-family-nav__side-nav"
          aria-label="Sibling navigation"
        >
          {previousSibling ? (
            <button
              className="recipe-family-nav__direction-button"
              type="button"
              onClick={() => selectNode(previousSibling.id)}
            >
              ← {previousSibling.title}
            </button>
          ) : (
            <button
              className="recipe-family-nav__direction-button"
              type="button"
              disabled
            >
              ← No previous sibling
            </button>
          )}
          {nextSibling ? (
            <button
              className="recipe-family-nav__direction-button"
              type="button"
              onClick={() => selectNode(nextSibling.id)}
            >
              {nextSibling.title} →
            </button>
          ) : (
            <button
              className="recipe-family-nav__direction-button"
              type="button"
              disabled
            >
              No next sibling →
            </button>
          )}
        </div>

        <div className="recipe-family-nav__children-area">
          <div className="recipe-family-nav__relationship-divider recipe-family-nav__children-divider">
            <span>
              Children ↓
              <span className="recipe-family-nav__children-count">
                {visibleChildrenCount}
              </span>
            </span>
          </div>
          <div className="recipe-family-nav__children-grid">
            {children.map((child) => (
              <FamilyNeighborCard
                key={child.id}
                currentRecipeId={currentRecipeId}
                label="Child"
                node={child}
                onSelect={selectNode}
              />
            ))}
            {visibleChildrenCount === 0 ? (
              <p className="recipe-family-nav__child-empty">
                No versions have been created from this recipe yet.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
