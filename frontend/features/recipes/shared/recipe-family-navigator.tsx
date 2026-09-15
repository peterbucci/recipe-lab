"use client";

import { useMemo, useRef, useState } from "react";

import { GuardedLink } from "../../../shared/navigation/navigation-blocker-provider";
import type { RecipeDetail, RecipeVersionReference } from "./recipe-contracts";
import type { RecipeHistory, RecipeHistoryEntry } from "./recipe-history";
import { exactRecipePath } from "./recipe-paths";
import { RecipeArtwork } from "./recipe-artwork";

interface RecipeFamilyNavigatorProps {
  currentPath?: string;
  draftPreview?: RecipeFamilyDraftPreview;
  history?: RecipeHistory | null;
  recipe: RecipeDetail;
}

export interface RecipeFamilyDraftPreview {
  authorDisplayName: string;
  id: string;
  parentVersionId: string;
  title: string;
}

interface FamilyNode {
  authorDisplayName: string;
  declaredChangeReason: "correction" | "update" | null;
  editionNumber: number | null;
  id: string;
  isCurrent: boolean;
  kind: "adaptation" | "draft" | "edition";
  parentVersionId: string | null;
  title: string;
}

function nodeFromEntry(
  entry: RecipeHistoryEntry,
  kind: "adaptation" | "edition",
): FamilyNode {
  return {
    authorDisplayName: entry.author.display_name,
    declaredChangeReason: entry.declared_change_reason,
    editionNumber: entry.edition_number,
    id: entry.id,
    isCurrent: entry.is_current,
    kind,
    parentVersionId:
      kind === "adaptation"
        ? entry.adaptation_source_version_id
        : entry.previous_version_id ?? entry.adaptation_source_version_id,
    title: entry.title,
  };
}

function nodeFromRecipe(recipe: RecipeDetail): FamilyNode {
  const kind = recipe.relation_kind === "adaptation" ? "adaptation" : "edition";
  return {
    authorDisplayName: recipe.author.display_name,
    declaredChangeReason: recipe.declared_change_reason,
    editionNumber: recipe.edition_number,
    id: recipe.id,
    isCurrent: recipe.is_current,
    kind,
    parentVersionId:
      kind === "adaptation"
        ? recipe.adaptation_source?.id ?? recipe.parent_version_id
        : recipe.previous_version_id ??
          recipe.adaptation_source?.id ??
          recipe.parent_version_id,
    title: recipe.title,
  };
}

function nodeFromReference(version: RecipeVersionReference): FamilyNode {
  return {
    authorDisplayName: version.author.display_name,
    declaredChangeReason: null,
    editionNumber: null,
    id: version.id,
    isCurrent: false,
    kind: "edition",
    parentVersionId: null,
    title: version.title,
  };
}

function nodeFromDraft(preview: RecipeFamilyDraftPreview): FamilyNode {
  return {
    authorDisplayName: preview.authorDisplayName,
    declaredChangeReason: null,
    editionNumber: null,
    id: preview.id,
    isCurrent: false,
    kind: "draft",
    parentVersionId: preview.parentVersionId,
    title: preview.title,
  };
}

function buildFamilyNodes(
  recipe: RecipeDetail,
  history: RecipeHistory | null,
): Map<string, FamilyNode> {
  const nodes = new Map<string, FamilyNode>();
  for (const edition of history?.editions ?? []) {
    nodes.set(
      edition.id,
      nodeFromEntry(
        edition,
        edition.relation_kind === "adaptation" ? "adaptation" : "edition",
      ),
    );
  }
  for (const adaptation of history?.adaptations ?? []) {
    nodes.set(adaptation.id, nodeFromEntry(adaptation, "adaptation"));
  }
  const readableSource = recipe.adaptation_source ?? recipe.parent;
  if (readableSource && !nodes.has(readableSource.id)) {
    nodes.set(readableSource.id, nodeFromReference(readableSource));
  }
  // Bounded history can omit the selected edition; the readable detail owns
  // the exact node currently open.
  if (!nodes.has(recipe.id)) nodes.set(recipe.id, nodeFromRecipe(recipe));
  return nodes;
}

function sortedNodes(nodes: Iterable<FamilyNode>): FamilyNode[] {
  return [...nodes].sort(
    (left, right) =>
      (left.editionNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.editionNumber ?? Number.MAX_SAFE_INTEGER) ||
      left.title.localeCompare(right.title),
  );
}

function nodeType(node: FamilyNode): string {
  if (node.kind === "draft") return "Current draft";
  if (node.kind === "adaptation") return "Adaptation";
  return node.editionNumber === null
    ? "Published source"
    : `Published version ${node.editionNumber}`;
}

function nodeMeta(node: FamilyNode): string {
  if (node.kind === "draft") return "Would become an adaptation · Not published";
  if (node.kind === "adaptation") {
    return `Published version ${node.editionNumber}${node.isCurrent ? " · Current" : ""}`;
  }
  return node.isCurrent ? "Current published version" : "Published version";
}

function AuthorDeclaredReason({ node }: { node: FamilyNode }) {
  if (node.declaredChangeReason === null) return null;
  return (
    <span className="recipe-family-nav__declared-reason">
      Author marked this version as a {node.declaredChangeReason}.
    </span>
  );
}

function RecipeNodeLink({
  currentPath,
  node,
}: {
  currentPath?: string;
  node: FamilyNode;
}) {
  const href = exactRecipePath(node.id);
  return (
    <GuardedLink
      className="recipe-family-nav__title-link"
      href={href}
      aria-current={currentPath === href ? "page" : undefined}
    >
      {node.title}
    </GuardedLink>
  );
}

function FamilyNeighborCard({
  currentPath,
  label,
  node,
  onSelect,
}: {
  currentPath?: string;
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
            ? `Show current draft ${node.title} in recipe history`
            : `Show ${node.title} in recipe history`
        }
        onClick={() => onSelect(node.id)}
      />
      <RecipeArtwork className="recipe-family-nav__artwork" recipeKey={node.id} />
      <span className="recipe-family-nav__neighbor-copy">
        <span className="recipe-family-nav__node-type">
          {node.kind === "draft" ? "Current draft" : label}
        </span>
        {node.kind === "draft" ? (
          <strong className="recipe-family-nav__draft-title">{node.title}</strong>
        ) : (
          <RecipeNodeLink currentPath={currentPath} node={node} />
        )}
        <span className="recipe-family-nav__author">By {node.authorDisplayName}</span>
        <span className="recipe-family-nav__node-meta">
          <span>{nodeType(node)}</span>
          <span>{nodeMeta(node)}</span>
        </span>
        <AuthorDeclaredReason node={node} />
      </span>
    </article>
  );
}

export function RecipeFamilyNavigator({
  currentPath,
  draftPreview,
  history = null,
  recipe,
}: RecipeFamilyNavigatorProps) {
  const publishedNodes = useMemo(
    () => buildFamilyNodes(recipe, history),
    [history, recipe],
  );
  const nodes = useMemo(() => {
    const result = new Map(publishedNodes);
    if (draftPreview) result.set(draftPreview.id, nodeFromDraft(draftPreview));
    return result;
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
  const focused = nodes.get(focusedId) ?? nodes.get(recipe.id)!;
  const parent = focused.parentVersionId
    ? nodes.get(focused.parentVersionId) ?? null
    : null;
  const parentUnavailable = focused.parentVersionId !== null && parent === null;
  const children = sortedNodes(
    [...nodes.values()].filter(
      (candidate) => candidate.parentVersionId === focused.id,
    ),
  );
  const siblings = parent
    ? sortedNodes(
        [...nodes.values()].filter(
          (candidate) => candidate.parentVersionId === parent.id,
        ),
      )
    : [];
  const siblingIndex = siblings.findIndex((candidate) => candidate.id === focused.id);
  const previousSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
  const nextSibling =
    siblingIndex >= 0 && siblingIndex < siblings.length - 1
      ? siblings[siblingIndex + 1]
      : null;

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
            Recipe history
          </h2>
          <p>
            Published versions stay exact. Select a card to explore its sources and adaptations.
          </p>
        </div>
        <span className="recipe-family-nav__position">{nodeType(focused)}</span>
      </div>

      {history === null ? (
        <p className="recipe-family-nav__history-status" role="status">
          Recipe history is unavailable right now. The open recipe is still available.
        </p>
      ) : null}

      <div className="recipe-family-nav__focus-shell">
        {parent ? (
          <div className="recipe-family-nav__parent-area">
            <div className="recipe-family-nav__parent-card">
              <FamilyNeighborCard
                currentPath={currentPath}
                label={focused.kind === "edition" ? "Previous version" : "Exact source"}
                node={parent}
                onSelect={selectNode}
              />
            </div>
          </div>
        ) : parentUnavailable ? (
          <div className="recipe-family-nav__parent-area">
            <article className="recipe-family-nav__unavailable-parent">
              <span className="recipe-family-nav__node-type">
                {focused.kind === "edition" ? "Previous version" : "Exact source"}
              </span>
              <h3>Source unavailable</h3>
            </article>
          </div>
        ) : null}

        {parent || parentUnavailable ? (
          <div className="recipe-family-nav__relationship-divider recipe-family-nav__parent-divider">
            <span>{focused.kind === "edition" ? "Previous version" : "Exact source"} ↑</span>
          </div>
        ) : null}

        <div className="recipe-family-nav__focus-row">
          <div className={`recipe-family-nav__sibling-slot${previousSibling ? "" : " recipe-family-nav__sibling-slot--empty"}`}>
            {previousSibling ? (
              <FamilyNeighborCard currentPath={currentPath} label="Related" node={previousSibling} onSelect={selectNode} />
            ) : null}
          </div>

          <article
            className={`recipe-family-nav__current-card${focused.kind === "draft" ? " recipe-family-nav__current-card--draft" : ""}`}
            aria-current={focused.kind === "draft" ? "page" : undefined}
            aria-label={`${focused.kind === "draft" ? "Selected current draft" : "Selected published recipe"}: ${focused.title}`}
          >
            <RecipeArtwork className="recipe-family-nav__current-artwork" recipeKey={focused.id} />
            <div className="recipe-family-nav__current-copy">
              <div className="recipe-family-nav__current-topline">
                <span className="recipe-family-nav__node-type">{nodeType(focused)}</span>
                <span className="recipe-family-nav__current-badge">Selected</span>
              </div>
              <h3>
                {focused.kind === "draft" ? focused.title : <RecipeNodeLink currentPath={currentPath} node={focused} />}
              </h3>
              <p>By {focused.authorDisplayName}</p>
              <span className="recipe-family-nav__node-meta"><span>{nodeMeta(focused)}</span></span>
              <AuthorDeclaredReason node={focused} />
              {focused.kind !== "draft" && focused.id !== recipe.id ? (
                <GuardedLink
                  className="recipe-family-nav__change-link"
                  href={`${exactRecipePath(focused.id)}/compare?base_version_id=${encodeURIComponent(recipe.id)}`}
                >
                  Compare with {recipe.title} →
                </GuardedLink>
              ) : null}
            </div>
          </article>

          <div className={`recipe-family-nav__sibling-slot${nextSibling ? "" : " recipe-family-nav__sibling-slot--empty"}`}>
            {nextSibling ? (
              <FamilyNeighborCard currentPath={currentPath} label="Related" node={nextSibling} onSelect={selectNode} />
            ) : null}
          </div>
        </div>

        <div className="recipe-family-nav__side-nav" aria-label="Related recipe navigation">
          <button className="recipe-family-nav__direction-button" type="button" disabled={!previousSibling} onClick={() => previousSibling && selectNode(previousSibling.id)}>
            ← {previousSibling?.title ?? "No previous related recipe"}
          </button>
          <button className="recipe-family-nav__direction-button" type="button" disabled={!nextSibling} onClick={() => nextSibling && selectNode(nextSibling.id)}>
            {nextSibling?.title ?? "No next related recipe"} →
          </button>
        </div>

        <div className="recipe-family-nav__children-area">
          <div className="recipe-family-nav__relationship-divider recipe-family-nav__children-divider">
            <span>
              Later versions and adaptations ↓
              <span className="recipe-family-nav__children-count">{children.length}</span>
            </span>
          </div>
          <div className="recipe-family-nav__children-grid">
            {children.map((child) => (
              <FamilyNeighborCard
                key={child.id}
                currentPath={currentPath}
                label={child.kind === "adaptation" ? "Adaptation" : "Later version"}
                node={child}
                onSelect={selectNode}
              />
            ))}
            {children.length === 0 ? (
              <p className="recipe-family-nav__child-empty">
                No readable later versions or adaptations are available from this exact version.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {history?.editions_truncated || history?.adaptations_truncated ? (
        <p className="recipe-family-nav__history-status">
          Some older history is not shown in this bounded view.
        </p>
      ) : null}
    </section>
  );
}
