"use client";

import Link from "next/link";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { RecipeCardSummary, RecipeDetail } from "../../lib/recipe-api";
import type { RecipeDraftEditorEntry } from "../../lib/recipe-draft-editor-entry";
import { RecipeDetailView } from "./recipe-detail-view";
import { RecipeDraftEditor } from "./recipe-draft-editor";

interface RecipeDetailExperienceProps {
  familyVersions: RecipeCardSummary[];
  recipe: RecipeDetail;
}

export function RecipeDetailExperience({
  familyVersions,
  recipe,
}: RecipeDetailExperienceProps) {
  const [hasActiveDraft, setHasActiveDraft] = useState(false);
  const [editorEntry, setEditorEntry] = useState<RecipeDraftEditorEntry | null>(
    null,
  );
  const transitionScrollPosition = useRef<{ x: number; y: number } | null>(
    null,
  );
  const publicPath = `/recipes/${encodeURIComponent(recipe.id)}`;

  const enterEditableVersion = useCallback((entry: RecipeDraftEditorEntry) => {
    transitionScrollPosition.current = {
      x: window.scrollX,
      y: window.scrollY,
    };
    setEditorEntry(entry);
  }, []);

  const returnToRecipeView = useCallback(() => {
    transitionScrollPosition.current = {
      x: window.scrollX,
      y: window.scrollY,
    };
    setEditorEntry(null);
    const currentState: unknown = window.history.state;
    const historyState: Record<string, unknown> =
      typeof currentState === "object" && currentState !== null
        ? { ...(currentState as Record<string, unknown>) }
        : {};
    delete historyState.recipeLabInlineDraft;
    delete historyState.__recipeDraftGuard;
    window.history.replaceState(historyState, "", publicPath);
  }, [publicPath]);

  useLayoutEffect(() => {
    const position = transitionScrollPosition.current;
    if (position === null) return;
    transitionScrollPosition.current = null;
    window.scrollTo(position.x, position.y);
  }, [editorEntry]);

  return (
    <main
      id="main-content"
      className="page-shell page-shell--detail recipe-reading-page"
    >
      {editorEntry !== null ? (
        <RecipeDraftEditor
          actionTypes={editorEntry.actionTypes}
          draftId={editorEntry.detail.id}
          embedded
          familyRecipe={recipe}
          familyVersions={familyVersions}
          initialCategories={editorEntry.categories}
          initialDetail={editorEntry.detail}
          measurementUnits={editorEntry.measurementUnits}
          onDoneForNow={returnToRecipeView}
          presentation="recipe"
        />
      ) : (
        <>
          <nav
            className="breadcrumb recipe-detail-breadcrumb"
            aria-label="Breadcrumb"
          >
            <Link
              href={hasActiveDraft ? "/account/recipes?view=drafts" : "/recipes"}
            >
              {hasActiveDraft ? "My recipes" : "Explore"}
            </Link>
            <span aria-hidden="true">/</span>
            {recipe.parent ? (
              <>
                <Link href={`/recipes/${recipe.parent.id}`}>
                  {recipe.parent.title}
                </Link>
                <span aria-hidden="true">/</span>
              </>
            ) : null}
            <span aria-current="page">{recipe.title}</span>
          </nav>
          <RecipeDetailView
            familyVersions={familyVersions}
            onActiveDraftChange={setHasActiveDraft}
            onEditableVersionReady={enterEditableVersion}
            recipe={recipe}
          />
        </>
      )}
    </main>
  );
}
