"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useAuthSession } from "../../../features/auth/auth-session-provider";
import { isAbortError } from "../../../shared/api/abort-error";
import { findActiveRecipeDraftForSource } from "../../../features/recipes/authoring/draft/recipe-draft-api";
import {
  prepareRecipeDraftEditorEntry,
  RecipeDraftEditorEntryError,
  type RecipeDraftEditorEntry,
} from "../../../features/recipes/authoring/draft/recipe-draft-editor-entry";
import { recipeDraftEntryErrorMessage } from "../../../features/recipes/authoring/draft/recipe-draft-entry";
import { RecipeDraftEditor } from "../../../features/recipes/authoring/editor/recipe-draft-editor";
import { RecipeDetailView } from "../../../features/recipes/detail/recipe-detail-view";
import type { RecipeDetail } from "../../../features/recipes/shared/recipe-contracts";
import type { RecipeHistory } from "../../../features/recipes/shared/recipe-history";
import { exactRecipePath } from "../../../features/recipes/shared/recipe-paths";

interface RecipeDetailExperienceProps {
  history: RecipeHistory | null;
  publicPath: string;
  recipe: RecipeDetail;
}

type EditableDraftKind = "adaptation" | "revision";

interface ResourceIdentity {
  draftKind: EditableDraftKind;
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

type ActiveDraftStates = Record<EditableDraftKind, ActiveDraftState>;

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
  draftKind: EditableDraftKind,
): boolean {
  return (
    value.ownerId === ownerId &&
    value.sourceVersionId === sourceVersionId &&
    value.draftKind === draftKind
  );
}

export function RecipeDetailExperience({
  history,
  publicPath,
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
      key={`${ownerId ?? "public"}:${sourceVersionId}:${publicPath}`}
      history={history}
      ownerId={ownerId}
      publicPath={publicPath}
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
  history,
  ownerId,
  publicPath,
  recipe,
  sourceVersionId,
}: RecipeDetailResourceProps) {
  const [activeDraftStates, setActiveDraftStates] = useState<ActiveDraftStates>({
    adaptation: { phase: "idle" },
    revision: { phase: "idle" },
  });
  const [preparationState, setPreparationState] = useState<PreparationState>({
    phase: "idle",
  });
  const [scopedEditorEntry, setScopedEditorEntry] =
    useState<ScopedEditorEntry | null>(null);
  const lifetimeActiveRef = useRef(false);
  const activeDraftRequestIdsRef = useRef<Record<EditableDraftKind, number>>({
    adaptation: 0,
    revision: 0,
  });
  const activeDraftControllersRef = useRef<
    Partial<Record<EditableDraftKind, AbortController>>
  >({});
  const preparationAttemptIdRef = useRef(0);
  const activePreparationRef = useRef<PreparationAttempt | null>(null);
  const transitionScrollPosition = useRef<{ x: number; y: number } | null>(
    null,
  );
  const [restoreEditActionFocus, setRestoreEditActionFocus] = useState(false);

  const loadActiveDraft = useCallback((draftKind: EditableDraftKind) => {
    if (ownerId === null) return null;

    activeDraftControllersRef.current[draftKind]?.abort();
    const controller = new AbortController();
    const request: ActiveDraftRequest = {
      draftKind,
      ownerId,
      requestId: activeDraftRequestIdsRef.current[draftKind] + 1,
      sourceVersionId,
    };
    activeDraftRequestIdsRef.current[draftKind] = request.requestId;
    activeDraftControllersRef.current[draftKind] = controller;

    void findActiveRecipeDraftForSource(
      sourceVersionId,
      draftKind,
      controller.signal,
    )
      .then((draft) => {
        if (
          !lifetimeActiveRef.current ||
          controller.signal.aborted ||
          activeDraftRequestIdsRef.current[draftKind] !== request.requestId
        ) {
          return;
        }
        setActiveDraftStates((current) => ({
          ...current,
          [draftKind]: {
            ...request,
            draftId: draft?.id ?? null,
            phase: "ready",
          },
        }));
      })
      .catch((reason: unknown) => {
        if (
          !lifetimeActiveRef.current ||
          controller.signal.aborted ||
          activeDraftRequestIdsRef.current[draftKind] !== request.requestId ||
          isAbortError(reason)
        ) {
          return;
        }
        setActiveDraftStates((current) => ({
          ...current,
          [draftKind]: { ...request, phase: "error" },
        }));
      })
      .finally(() => {
        if (activeDraftControllersRef.current[draftKind] === controller) {
          delete activeDraftControllersRef.current[draftKind];
        }
      });

    return controller;
  }, [ownerId, sourceVersionId]);

  useLayoutEffect(() => {
    const activeDraftRequestIds = activeDraftRequestIdsRef.current;
    const activeDraftControllers = activeDraftControllersRef.current;
    lifetimeActiveRef.current = true;
    return () => {
      lifetimeActiveRef.current = false;
      activeDraftRequestIds.adaptation += 1;
      activeDraftRequestIds.revision += 1;
      activeDraftControllers.adaptation?.abort();
      activeDraftControllers.revision?.abort();
      activeDraftControllersRef.current = {};
      preparationAttemptIdRef.current += 1;
      activePreparationRef.current = null;
      setPreparationState((current) =>
        current.phase === "loading" ? { phase: "idle" } : current,
      );
    };
  }, []);

  useEffect(() => {
    const adaptationController = loadActiveDraft("adaptation");
    const revisionController = loadActiveDraft("revision");
    return () => {
      adaptationController?.abort();
      revisionController?.abort();
    };
  }, [loadActiveDraft]);

  const activeDraftId = (draftKind: EditableDraftKind): string | null => {
    const state = activeDraftStates[draftKind];
    return ownerId !== null &&
      state.phase === "ready" &&
      hasIdentity(state, ownerId, sourceVersionId, draftKind)
      ? state.draftId
      : null;
  };
  const currentPreparationState =
    ownerId !== null &&
    preparationState.phase !== "idle" &&
    hasIdentity(
      preparationState,
      ownerId,
      sourceVersionId,
      preparationState.draftKind,
    )
      ? preparationState
      : null;
  const currentEditorEntry =
    ownerId !== null &&
    scopedEditorEntry !== null &&
    hasIdentity(
      scopedEditorEntry,
      ownerId,
      sourceVersionId,
      scopedEditorEntry.draftKind,
    )
      ? scopedEditorEntry.entry
      : null;

  const requestEditableVersion = useCallback((draftKind: EditableDraftKind) => {
    if (ownerId === null) return;
    setRestoreEditActionFocus(false);
    const currentAttempt = activePreparationRef.current;
    if (
      currentAttempt !== null &&
      hasIdentity(currentAttempt, ownerId, sourceVersionId, draftKind)
    ) {
      return;
    }

    const attempt: PreparationAttempt = {
      attemptId: preparationAttemptIdRef.current + 1,
      draftKind,
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
        hasIdentity(
          activeAttempt,
          attempt.ownerId,
          attempt.sourceVersionId,
          attempt.draftKind,
        )
      );
    };

    void prepareRecipeDraftEditorEntry(ownerId, sourceVersionId, draftKind)
      .then((entry) => {
        if (!isCurrentAttempt()) return;
        if (
          entry.detail.draft_kind !== draftKind ||
          entry.detail.source_version_id?.toLowerCase() !== sourceVersionId
        ) {
          throw new RecipeDraftEditorEntryError();
        }

        activeDraftRequestIdsRef.current[draftKind] += 1;
        activeDraftControllersRef.current[draftKind]?.abort();
        delete activeDraftControllersRef.current[draftKind];
        setActiveDraftStates((current) => ({
          ...current,
          [draftKind]: {
            ...attempt,
            draftId: entry.detail.id,
            phase: "ready",
            requestId: activeDraftRequestIdsRef.current[draftKind],
          },
        }));
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
        loadActiveDraft(draftKind);
      })
      .finally(() => {
        if (isCurrentAttempt()) {
          activePreparationRef.current = null;
        }
      });
  }, [loadActiveDraft, ownerId, sourceVersionId]);

  const returnToRecipeView = useCallback(() => {
    const draftKind = scopedEditorEntry?.draftKind ?? null;
    transitionScrollPosition.current = {
      x: window.scrollX,
      y: window.scrollY,
    };
    setRestoreEditActionFocus(true);
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
    if (draftKind !== null) {
      loadActiveDraft(draftKind);
    }
  }, [loadActiveDraft, publicPath, scopedEditorEntry]);

  useLayoutEffect(() => {
    const position = transitionScrollPosition.current;
    if (position !== null) {
      transitionScrollPosition.current = null;
      window.scrollTo(position.x, position.y);
    }

    if (currentEditorEntry !== null) {
      document.querySelector<HTMLElement>("#draft-title")?.focus();
      return;
    }

  }, [currentEditorEntry]);

  const editAction = {
    activeDrafts: {
      adaptation: activeDraftId("adaptation") !== null,
      revision: activeDraftId("revision") !== null,
    },
    errorMessage:
      currentPreparationState?.phase === "error"
        ? currentPreparationState.message
        : null,
    pendingIntent:
      currentPreparationState?.phase === "loading"
        ? currentPreparationState.draftKind
        : null,
  };
  const hasAnyActiveDraft =
    activeDraftId("adaptation") !== null ||
    activeDraftId("revision") !== null;
  const adaptationSource = recipe.adaptation_source ?? recipe.parent;

  return (
    <main
      id="main-content"
      className="page-shell page-shell--detail recipe-reading-page"
    >
      {currentEditorEntry !== null ? (
        <RecipeDraftEditor
          key={`${currentEditorEntry.detail.id}:${currentEditorEntry.detail.draft_kind}`}
          actionTypes={currentEditorEntry.actionTypes}
          draftId={currentEditorEntry.detail.id}
          embedded
          familyHistory={history}
          familyRecipe={recipe}
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
              href={hasAnyActiveDraft ? "/account/recipes?view=drafts" : "/recipes"}
            >
              {hasAnyActiveDraft ? "My recipes" : "Explore"}
            </Link>
            <span aria-hidden="true">/</span>
            {adaptationSource ? (
              <>
                <Link href={exactRecipePath(adaptationSource.id)}>
                  {adaptationSource.title}
                </Link>
                <span aria-hidden="true">/</span>
              </>
            ) : null}
            <span aria-current="page">{recipe.title}</span>
          </nav>
          <RecipeDetailView
            editAction={editAction}
            history={history}
            onEditActionFocusRestored={() =>
              setRestoreEditActionFocus(false)
            }
            onRequestEdit={requestEditableVersion}
            publicPath={publicPath}
            recipe={recipe}
            restoreEditActionFocus={restoreEditActionFocus}
          />
        </>
      )}
    </main>
  );
}
