"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useAuthSession } from "../../../../features/auth/auth-session-provider";
import { isAbortError } from "../../../../shared/api/abort-error";
import { findActiveRecipeDraftForSource } from "../../../../features/recipes/authoring/draft/recipe-draft-api";
import {
  prepareRecipeDraftEditorEntry,
  RecipeDraftEditorEntryError,
  type RecipeDraftEditorEntry,
} from "../../../../features/recipes/authoring/draft/recipe-draft-editor-entry";
import { recipeDraftEntryErrorMessage } from "../../../../features/recipes/authoring/draft/recipe-draft-entry";
import { RecipeDraftEditor } from "../../../../features/recipes/authoring/editor/recipe-draft-editor";
import { RecipeDetailView } from "../../../../features/recipes/detail/recipe-detail-view";
import type {
  RecipeCardSummary,
  RecipeDetail,
} from "../../../../features/recipes/shared/recipe-contracts";

interface RecipeDetailExperienceProps {
  familyVersions: RecipeCardSummary[];
  recipe: RecipeDetail;
}

interface ResourceIdentity {
  ownerId: string;
  sourceVersionId: string;
}

interface ActiveDraftRequest extends ResourceIdentity {
  requestId: number;
}

type ActiveDraftState =
  | { phase: "idle" }
  | ({ phase: "ready"; draftId: string | null } & ActiveDraftRequest)
  | ({ phase: "error" } & ActiveDraftRequest);

interface PreparationAttempt extends ResourceIdentity {
  attemptId: number;
}

type PreparationState =
  | { phase: "idle" }
  | ({ phase: "loading" } & PreparationAttempt)
  | ({ phase: "error"; message: string } & PreparationAttempt);

interface ScopedEditorEntry extends ResourceIdentity {
  entry: RecipeDraftEditorEntry;
}

function hasIdentity(
  value: ResourceIdentity,
  ownerId: string,
  sourceVersionId: string,
): boolean {
  return (
    value.ownerId === ownerId && value.sourceVersionId === sourceVersionId
  );
}

export function RecipeDetailExperience({
  familyVersions,
  recipe,
}: RecipeDetailExperienceProps) {
  const { state: authState } = useAuthSession();
  const ownerId =
    authState.phase === "ready" &&
    authState.session.status === "authenticated"
      ? authState.session.user.id
      : null;
  const sourceVersionId = recipe.id.toLowerCase();

  return (
    <RecipeDetailResource
      key={`${ownerId ?? "public"}:${sourceVersionId}`}
      familyVersions={familyVersions}
      ownerId={ownerId}
      recipe={recipe}
      sourceVersionId={sourceVersionId}
    />
  );
}

interface RecipeDetailResourceProps extends RecipeDetailExperienceProps {
  ownerId: string | null;
  sourceVersionId: string;
}

function RecipeDetailResource({
  familyVersions,
  ownerId,
  recipe,
  sourceVersionId,
}: RecipeDetailResourceProps) {
  const [activeDraftState, setActiveDraftState] = useState<ActiveDraftState>({
    phase: "idle",
  });
  const [preparationState, setPreparationState] = useState<PreparationState>({
    phase: "idle",
  });
  const [scopedEditorEntry, setScopedEditorEntry] =
    useState<ScopedEditorEntry | null>(null);
  const lifetimeActiveRef = useRef(false);
  const activeDraftRequestIdRef = useRef(0);
  const activeDraftControllerRef = useRef<AbortController | null>(null);
  const preparationAttemptIdRef = useRef(0);
  const activePreparationRef = useRef<PreparationAttempt | null>(null);
  const transitionScrollPosition = useRef<{ x: number; y: number } | null>(
    null,
  );
  const publicPath = `/recipes/${encodeURIComponent(recipe.id)}`;

  const loadActiveDraft = useCallback(() => {
    if (ownerId === null) return null;

    activeDraftControllerRef.current?.abort();
    const controller = new AbortController();
    const request: ActiveDraftRequest = {
      ownerId,
      requestId: activeDraftRequestIdRef.current + 1,
      sourceVersionId,
    };
    activeDraftRequestIdRef.current = request.requestId;
    activeDraftControllerRef.current = controller;

    void findActiveRecipeDraftForSource(sourceVersionId, controller.signal)
      .then((draft) => {
        if (
          !lifetimeActiveRef.current ||
          controller.signal.aborted ||
          activeDraftRequestIdRef.current !== request.requestId
        ) {
          return;
        }
        setActiveDraftState({
          ...request,
          draftId: draft?.id ?? null,
          phase: "ready",
        });
      })
      .catch((reason: unknown) => {
        if (
          !lifetimeActiveRef.current ||
          controller.signal.aborted ||
          activeDraftRequestIdRef.current !== request.requestId ||
          isAbortError(reason)
        ) {
          return;
        }
        setActiveDraftState({ ...request, phase: "error" });
      })
      .finally(() => {
        if (activeDraftControllerRef.current === controller) {
          activeDraftControllerRef.current = null;
        }
      });

    return controller;
  }, [ownerId, sourceVersionId]);

  useLayoutEffect(() => {
    lifetimeActiveRef.current = true;
    return () => {
      lifetimeActiveRef.current = false;
      activeDraftRequestIdRef.current += 1;
      activeDraftControllerRef.current?.abort();
      activeDraftControllerRef.current = null;
      preparationAttemptIdRef.current += 1;
      activePreparationRef.current = null;
      setPreparationState((current) =>
        current.phase === "loading" ? { phase: "idle" } : current,
      );
    };
  }, []);

  useEffect(() => {
    const controller = loadActiveDraft();
    return () => controller?.abort();
  }, [loadActiveDraft]);

  const activeDraftId =
    ownerId !== null &&
    activeDraftState.phase === "ready" &&
    hasIdentity(activeDraftState, ownerId, sourceVersionId)
      ? activeDraftState.draftId
      : null;
  const currentPreparationState =
    ownerId !== null &&
    preparationState.phase !== "idle" &&
    hasIdentity(preparationState, ownerId, sourceVersionId)
      ? preparationState
      : null;
  const currentEditorEntry =
    ownerId !== null &&
    scopedEditorEntry !== null &&
    hasIdentity(scopedEditorEntry, ownerId, sourceVersionId)
      ? scopedEditorEntry.entry
      : null;

  const requestEditableVersion = useCallback(() => {
    if (ownerId === null) return;
    const currentAttempt = activePreparationRef.current;
    if (
      currentAttempt !== null &&
      hasIdentity(currentAttempt, ownerId, sourceVersionId)
    ) {
      return;
    }

    const attempt: PreparationAttempt = {
      attemptId: preparationAttemptIdRef.current + 1,
      ownerId,
      sourceVersionId,
    };
    preparationAttemptIdRef.current = attempt.attemptId;
    activePreparationRef.current = attempt;
    setPreparationState({ ...attempt, phase: "loading" });

    const isCurrentAttempt = () => {
      const activeAttempt = activePreparationRef.current;
      return (
        lifetimeActiveRef.current &&
        activeAttempt !== null &&
        activeAttempt.attemptId === attempt.attemptId &&
        hasIdentity(activeAttempt, attempt.ownerId, attempt.sourceVersionId)
      );
    };

    void prepareRecipeDraftEditorEntry(ownerId, sourceVersionId)
      .then((entry) => {
        if (!isCurrentAttempt()) return;
        if (entry.detail.source_version_id?.toLowerCase() !== sourceVersionId) {
          throw new RecipeDraftEditorEntryError();
        }

        activeDraftRequestIdRef.current += 1;
        activeDraftControllerRef.current?.abort();
        activeDraftControllerRef.current = null;
        setActiveDraftState({
          ...attempt,
          draftId: entry.detail.id,
          phase: "ready",
          requestId: activeDraftRequestIdRef.current,
        });
        transitionScrollPosition.current = {
          x: window.scrollX,
          y: window.scrollY,
        };
        setScopedEditorEntry({ ...attempt, entry });
      })
      .catch((reason: unknown) => {
        if (!isCurrentAttempt()) return;
        setPreparationState({
          ...attempt,
          message:
            reason instanceof RecipeDraftEditorEntryError
              ? reason.message
              : recipeDraftEntryErrorMessage(reason),
          phase: "error",
        });
        loadActiveDraft();
      })
      .finally(() => {
        if (isCurrentAttempt()) {
          activePreparationRef.current = null;
        }
      });
  }, [loadActiveDraft, ownerId, sourceVersionId]);

  const returnToRecipeView = useCallback(() => {
    transitionScrollPosition.current = {
      x: window.scrollX,
      y: window.scrollY,
    };
    setScopedEditorEntry(null);
    setPreparationState({ phase: "idle" });

    const currentState: unknown = window.history.state;
    const historyState: Record<string, unknown> =
      typeof currentState === "object" && currentState !== null
        ? { ...(currentState as Record<string, unknown>) }
        : {};
    delete historyState.recipeLabInlineDraft;
    delete historyState.__recipeDraftGuard;
    window.history.replaceState(historyState, "", publicPath);
    loadActiveDraft();
  }, [loadActiveDraft, publicPath]);

  useLayoutEffect(() => {
    const position = transitionScrollPosition.current;
    if (position === null) return;
    transitionScrollPosition.current = null;
    window.scrollTo(position.x, position.y);
  }, [currentEditorEntry]);

  const editAction = {
    errorMessage:
      currentPreparationState?.phase === "error"
        ? currentPreparationState.message
        : null,
    hasActiveDraft: activeDraftId !== null,
    pending: currentPreparationState?.phase === "loading",
  };

  return (
    <main
      id="main-content"
      className="page-shell page-shell--detail recipe-reading-page"
    >
      {currentEditorEntry !== null ? (
        <RecipeDraftEditor
          actionTypes={currentEditorEntry.actionTypes}
          draftId={currentEditorEntry.detail.id}
          embedded
          familyRecipe={recipe}
          familyVersions={familyVersions}
          initialCategories={currentEditorEntry.categories}
          initialDetail={currentEditorEntry.detail}
          measurementUnits={currentEditorEntry.measurementUnits}
          onDoneForNow={returnToRecipeView}
        />
      ) : (
        <>
          <nav
            className="breadcrumb recipe-detail-breadcrumb"
            aria-label="Breadcrumb"
          >
            <Link
              href={
                activeDraftId !== null
                  ? "/account/recipes?view=drafts"
                  : "/recipes"
              }
            >
              {activeDraftId !== null ? "My recipes" : "Explore"}
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
            editAction={editAction}
            familyVersions={familyVersions}
            onRequestEdit={requestEditableVersion}
            recipe={recipe}
          />
        </>
      )}
    </main>
  );
}
