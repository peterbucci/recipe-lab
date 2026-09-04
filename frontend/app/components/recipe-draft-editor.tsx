"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { isAbortError } from "../../lib/abort-error";
import { AuthApiError } from "../../lib/auth-api";
import type { CatalogActionType } from "../../lib/cooking-action-api";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import type {
  RecipeCardSummary,
  RecipeCategory,
  RecipeDetail,
} from "../../lib/recipe-api";
import {
  fetchRecipeDraft,
  RecipeDraftApiError,
  type RecipeDraftDetail,
  updateRecipeDraft,
} from "../../lib/recipe-draft-api";
import {
  createDraftIngredientState,
  createDraftInstructionState,
  draftIngredientOptions,
  hydrateRecipeDraft,
  recipeDraftFieldErrorsFromIssues,
  recipeDraftFingerprint,
  type RecipeDraftValidation,
  validateRecipeDraft,
} from "../../lib/recipe-draft";
import {
  type DraftFailureKind,
  initialRecipeDraftEditorDomainState,
  prepareDraftSaveAttempt,
  recipeDraftEditorIsDirty,
  recipeDraftEditorReducer,
} from "../../lib/recipe-draft-editor-state";
import {
  initialRecipeDraftPublicationState,
  publicationBlocksDismissal,
  recipeDraftPublicationReducer,
} from "../../lib/recipe-draft-publication-state";
import {
  fetchRecipeFamily,
  type LoadedRecipeFamily,
} from "../../lib/recipe-family-client-api";
import { MemberRouteGate } from "./member-route-gate";
import { Dialog } from "./overlay-primitives";
import { useAuthSession } from "./auth-session-provider";
import {
  LoadingButton,
  PageLoadingSkeleton,
  SectionLoading,
} from "./loading-ui";
import {
  GuardedLink,
  useNavigationBlocker,
} from "./navigation-blocker-provider";
import { RecipeCategorySelector } from "./recipe-category-selector";
import { RecipeArtwork } from "./recipe-artwork";
import { RecipeDetailTabs } from "./recipe-detail-tabs";
import {
  RecipeDraftFactsFields,
  RecipeDraftIdentityFields,
} from "./recipe-draft-details-section";
import { RecipeDraftIngredientsSection } from "./recipe-draft-ingredients-section";
import { RecipeDraftInstructionsSection } from "./recipe-draft-instructions-section";
import { RecipeDraftNotesSection } from "./recipe-draft-notes-section";
import { RecipeDraftPublication } from "./recipe-draft-publication";
import { RecipeFamilyNavigator } from "./recipe-family-navigator";
import { RatingSummary } from "./rating-summary";

interface RecipeDraftEditorProps {
  actionTypes: readonly CatalogActionType[];
  draftId: string;
  embedded?: boolean;
  familyRecipe?: RecipeDetail;
  familyVersions?: readonly RecipeCardSummary[];
  initialCategories?: readonly RecipeCategory[];
  initialDetail?: RecipeDraftDetail;
  measurementUnits: readonly CatalogUnit[];
  onDoneForNow?: () => void;
  presentation?: "recipe";
}

interface EditorRequest {
  controller: AbortController;
  id: number;
}

function authorInitial(displayName: string): string {
  return displayName.trim().charAt(0).toLocaleUpperCase() || "Y";
}

export function RecipeDraftLoadingView({
  status = "Loading your private draft…",
}: {
  draftId: string;
  status?: string;
}) {
  return (
    <PageLoadingSkeleton
      className="page-shell page-shell--detail recipe-reading-page draft-editor-page draft-editor-page--loading recipe-workspace-page"
      exitHref="/account/recipes?view=drafts"
      exitLabel="My recipes"
      label={status}
      variant="authoring"
    />
  );
}

function draftLoadErrorMessage(reason: unknown): string {
  if (reason instanceof RecipeDraftApiError && reason.status === 404) {
    return "This private draft was not found. It may have been discarded, or it may belong to another account.";
  }
  return "Recipe Lab could not open this private draft. Please try again.";
}

function draftFailureKind(reason: unknown): DraftFailureKind {
  if (
    reason instanceof RecipeDraftApiError &&
    reason.code === "recipe_draft_revision_conflict"
  ) {
    return "revision-conflict";
  }
  if (
    (reason instanceof RecipeDraftApiError || reason instanceof AuthApiError) &&
    reason.status === 401
  ) {
    return "authentication-interruption";
  }
  if (
    !(
      reason instanceof RecipeDraftApiError || reason instanceof AuthApiError
    ) ||
    (reason instanceof RecipeDraftApiError &&
      (reason.code === "invalid_recipe_draft_response" ||
        reason.outcome === "unknown"))
  ) {
    return "ambiguous-result";
  }
  return "failed-retryable";
}

function initialEditorDomainState(detail: RecipeDraftDetail | undefined) {
  if (!detail) return initialRecipeDraftEditorDomainState;
  const draft = hydrateRecipeDraft(detail);
  return recipeDraftEditorReducer(initialRecipeDraftEditorDomainState, {
    detail,
    draft,
    mode: "initial",
    type: "draft-loaded",
  });
}

type DraftLoadResult = "failed" | "loaded" | "skipped-newer-work";

function RecipeDraftEditorInner({
  actionTypes,
  draftId,
  embedded = false,
  familyRecipe,
  familyVersions,
  initialCategories,
  initialDetail,
  measurementUnits,
  onDoneForNow,
}: RecipeDraftEditorProps) {
  const { state: authState } = useAuthSession();
  const { confirmNavigation, setBlocked } = useNavigationBlocker();
  const [domain, dispatch] = useReducer(
    recipeDraftEditorReducer,
    initialDetail,
    initialEditorDomainState,
  );
  const [publicationState, publicationDispatch] = useReducer(
    recipeDraftPublicationReducer,
    initialRecipeDraftPublicationState,
  );
  const [loading, setLoading] = useState(initialDetail === undefined);
  const [loadError, setLoadError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [finishOpen, setFinishOpen] = useState(false);
  const [loadedRecipeFamily, setLoadedRecipeFamily] =
    useState<LoadedRecipeFamily | null>(null);
  const [failedFamilySourceId, setFailedFamilySourceId] = useState<
    string | null
  >(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const finishTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingFocusId = useRef<string | null>(null);
  const latestDraftFingerprint = useRef(
    domain.work.status === "unavailable"
      ? ""
      : recipeDraftFingerprint(domain.work.draft),
  );
  const loadRequestToken = useRef(0);
  const nextSaveRequestId = useRef(0);
  const activeSaveRequest = useRef<EditorRequest | null>(null);

  const work = domain.work.status === "unavailable" ? null : domain.work;
  const detail = work?.detail ?? null;
  const draft = work?.draft ?? null;
  const { fieldErrors, formError } = domain.validation;
  const dirty = recipeDraftEditorIsDirty(domain);
  const publicationBusy = publicationBlocksDismissal(publicationState);
  const pending = domain.save.status === "saving" ? "save" : null;
  const conflict = domain.save.status === "revision-conflict";
  const authenticationInterrupted =
    domain.save.status === "authentication-interruption";
  const editorStatus =
    domain.save.status === "saving"
      ? "Saving your private draft…"
      : domain.save.status === "saved"
        ? domain.save.newerLocalWork
          ? "Earlier changes saved. Your newer edits are still unsaved."
          : "Draft saved privately."
        : domain.notice === "loaded-latest"
          ? "Loaded the latest saved version."
          : dirty
            ? "You have unsaved changes."
            : "All changes are saved privately.";
  const member =
    authState.phase === "ready" && authState.session.status === "authenticated"
      ? authState.session.user
      : null;

  const load = useCallback(
    async (
      signal?: AbortSignal,
      mode: "initial" | "replacement" = "initial",
      startingFingerprint = "",
    ): Promise<DraftLoadResult> => {
      const requestToken = ++loadRequestToken.current;
      setLoading(true);
      setLoadError("");
      try {
        const loaded = await fetchRecipeDraft(draftId, signal);
        const state = hydrateRecipeDraft(loaded);
        if (requestToken !== loadRequestToken.current) return "failed";
        if (
          mode === "replacement" &&
          latestDraftFingerprint.current !== startingFingerprint
        ) {
          dispatch({ type: "reload-skipped-newer-work" });
          return "skipped-newer-work";
        }
        latestDraftFingerprint.current = recipeDraftFingerprint(state);
        dispatch({ detail: loaded, draft: state, mode, type: "draft-loaded" });
        return "loaded";
      } catch (reason) {
        if (isAbortError(reason))
          return "failed";
        if (requestToken === loadRequestToken.current) {
          setLoadError(draftLoadErrorMessage(reason));
        }
        return "failed";
      } finally {
        if (!signal?.aborted && requestToken === loadRequestToken.current)
          setLoading(false);
      }
    },
    [draftId],
  );

  useEffect(() => {
    if (initialDetail !== undefined) return;

    const controller = new AbortController();
    const requestToken = ++loadRequestToken.current;
    void fetchRecipeDraft(draftId, controller.signal)
      .then((loaded) => {
        if (requestToken !== loadRequestToken.current) return;
        const state = hydrateRecipeDraft(loaded);
        latestDraftFingerprint.current = recipeDraftFingerprint(state);
        dispatch({
          detail: loaded,
          draft: state,
          mode: "initial",
          type: "draft-loaded",
        });
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason)) {
          return;
        }
        if (requestToken === loadRequestToken.current) {
          setLoadError(draftLoadErrorMessage(reason));
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          requestToken === loadRequestToken.current
        ) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [draftId, initialDetail]);

  useLayoutEffect(() => {
    if (draft) {
      latestDraftFingerprint.current = recipeDraftFingerprint(draft);
    }
  }, [draft]);

  useEffect(
    () => () => {
      activeSaveRequest.current?.controller.abort();
      activeSaveRequest.current = null;
    },
    [],
  );

  const sourceVersionId = detail?.source_version_id ?? null;
  const hasProvidedRecipeFamily =
    sourceVersionId !== null && familyRecipe?.id === sourceVersionId;

  useEffect(() => {
    if (sourceVersionId === null || hasProvidedRecipeFamily) return;

    const controller = new AbortController();
    void fetchRecipeFamily(sourceVersionId, controller.signal)
      .then((family) => {
        if (controller.signal.aborted) return;
        setLoadedRecipeFamily(family);
        setFailedFamilySourceId(null);
      })
      .catch((reason: unknown) => {
        if (
          controller.signal.aborted ||
          isAbortError(reason)
        ) {
          return;
        }
        setFailedFamilySourceId(sourceVersionId);
      });
    return () => controller.abort();
  }, [hasProvidedRecipeFamily, sourceVersionId]);
  useEffect(() => {
    setBlocked(dirty);
    return () => setBlocked(false);
  }, [dirty, setBlocked]);

  useLayoutEffect(() => {
    if (!pendingFocusId.current) return;
    document.getElementById(pendingFocusId.current)?.focus();
    pendingFocusId.current = null;
  }, [draft]);

  function addIngredient() {
    if (!draft || draft.ingredients.length >= 200) return;
    const row = createDraftIngredientState();
    pendingFocusId.current = `draft-${row.key}-ingredient-search`;
    dispatch({ ingredient: row, type: "ingredient-added" });
    setAnnouncement(`Added ingredient ${draft.ingredients.length + 1}.`);
  }

  function removeIngredient(index: number) {
    if (!draft) return;
    const row = draft.ingredients[index];
    if (!row) return;
    const affectedActions = draft.instructions.reduce(
      (count, instruction) =>
        count +
        instruction.actions.filter((action) =>
          action.ingredientKeys.includes(row.key),
        ).length,
      0,
    );
    if (
      affectedActions > 0 &&
      !window.confirm(
        `Remove ingredient ${index + 1}? This will also remove its link from ${affectedActions} cooking ${affectedActions === 1 ? "action" : "actions"}. The actions and their other details will remain.`,
      )
    ) {
      return;
    }
    const remaining = draft.ingredients.filter(
      (_, ingredientIndex) => ingredientIndex !== index,
    );
    const focus = remaining[Math.min(index, remaining.length - 1)];
    pendingFocusId.current = focus
      ? `draft-${focus.key}-ingredient-search`
      : "draft-add-ingredient";
    dispatch({ index, type: "ingredient-removed" });
    setAnnouncement(`Removed ingredient ${index + 1}.`);
  }

  function moveIngredient(index: number, direction: -1 | 1) {
    if (!draft) return;
    const destination = index + direction;
    if (destination < 0 || destination >= draft.ingredients.length) return;
    const moved = draft.ingredients[index];
    if (!moved) return;
    pendingFocusId.current = `draft-${moved.key}-ingredient-move-${direction < 0 ? "up" : "down"}`;
    dispatch({ direction, index, type: "ingredient-moved" });
    setAnnouncement(
      `Moved ingredient to position ${destination + 1} of ${draft.ingredients.length}.`,
    );
  }

  function addInstruction() {
    if (!draft || draft.instructions.length >= 100) return;
    const row = createDraftInstructionState();
    pendingFocusId.current = `draft-${row.key}-instruction-text`;
    dispatch({ instruction: row, type: "instruction-added" });
    setAnnouncement(`Added instruction ${draft.instructions.length + 1}.`);
  }

  function removeInstruction(index: number) {
    if (!draft) return;
    const remaining = draft.instructions.filter(
      (_, instructionIndex) => instructionIndex !== index,
    );
    const focus = remaining[Math.min(index, remaining.length - 1)];
    pendingFocusId.current = focus
      ? `draft-${focus.key}-instruction-text`
      : "draft-add-instruction";
    dispatch({ index, type: "instruction-removed" });
    setAnnouncement(`Removed instruction ${index + 1}.`);
  }

  function moveInstruction(index: number, direction: -1 | 1) {
    if (!draft) return;
    const destination = index + direction;
    if (destination < 0 || destination >= draft.instructions.length) return;
    const moved = draft.instructions[index];
    if (!moved) return;
    pendingFocusId.current = `draft-${moved.key}-instruction-move-${direction < 0 ? "up" : "down"}`;
    dispatch({ direction, index, type: "instruction-moved" });
    setAnnouncement(
      `Moved instruction to position ${destination + 1} of ${draft.instructions.length}.`,
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !detail || activeSaveRequest.current || pending) return;
    const validation = validateRecipeDraft(
      draft,
      detail.revision,
      measurementUnits,
      actionTypes,
    );
    if (!validation.payload) {
      dispatch({
        fieldErrors: validation.fieldErrors,
        formError:
          "Review the highlighted fields. Your draft has not been changed on the server.",
        type: "validation-applied",
      });
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return;
    }
    const currentFingerprint = recipeDraftFingerprint(draft);
    const attempt = prepareDraftSaveAttempt(domain, {
      fingerprint: currentFingerprint,
      newIdempotencyKey: createIdempotencyKey(),
      revision: detail.revision,
    });
    const request = {
      controller: new AbortController(),
      id: ++nextSaveRequestId.current,
    };
    activeSaveRequest.current = request;
    dispatch({ attempt, type: "save-started" });
    dispatch({ type: "validation-cleared" });
    try {
      const saved = await updateRecipeDraft(
        draftId,
        validation.payload,
        attempt.idempotencyKey,
        request.controller.signal,
      );
      if (
        activeSaveRequest.current?.id !== request.id ||
        request.controller.signal.aborted
      ) {
        return;
      }
      const savedState = hydrateRecipeDraft(saved);
      const hasNewerLocalWork =
        latestDraftFingerprint.current !== attempt.fingerprint;
      dispatch({
        attemptId: attempt.idempotencyKey,
        detail: saved,
        draft: savedState,
        type: "save-succeeded",
      });
      if (!hasNewerLocalWork)
        latestDraftFingerprint.current = recipeDraftFingerprint(savedState);
    } catch (reason) {
      if (
        request.controller.signal.aborted ||
        isAbortError(reason)
      ) {
        return;
      }
      if (activeSaveRequest.current?.id !== request.id) return;
      const kind = draftFailureKind(reason);
      dispatch({
        attemptId: attempt.idempotencyKey,
        kind,
        type: "save-failed",
      });
      const serverFieldErrors =
        reason instanceof RecipeDraftApiError && reason.issues.length > 0
          ? recipeDraftFieldErrorsFromIssues(draft, reason.issues)
          : {};
      if (Object.keys(serverFieldErrors).length > 0) {
        dispatch({
          fieldErrors: serverFieldErrors,
          formError: "Review the highlighted fields. Your edits are still here.",
          type: "validation-applied",
        });
      } else if (kind === "revision-conflict") {
        dispatch({
          fieldErrors: {},
          formError:
            "This draft changed in another tab. Your unsaved version is still here.",
          type: "validation-applied",
        });
      } else if (kind === "authentication-interruption") {
        dispatch({
          fieldErrors: {},
          formError:
            "Your session expired. Your edits are still here. Sign in again before saving.",
          type: "validation-applied",
        });
      } else {
        dispatch({
          fieldErrors: {},
          formError:
            "Recipe Lab could not save this draft. Your edits are still here.",
          type: "validation-applied",
        });
      }
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    } finally {
      if (activeSaveRequest.current?.id === request.id) {
        activeSaveRequest.current = null;
      }
    }
  }

  async function reloadSavedVersion() {
    if (
      !window.confirm(
        "Replace your unsaved version with the latest saved version?",
      )
    )
      return;
    const startingFingerprint = latestDraftFingerprint.current;
    await load(undefined, "replacement", startingFingerprint);
  }

  function applyPublicationValidation(validation: RecipeDraftValidation) {
    if (validation.payload) {
      dispatch({ type: "validation-cleared" });
      return;
    }
    dispatch({
      fieldErrors: validation.fieldErrors,
      formError:
        validation.formErrors.length > 0
          ? validation.formErrors.join(" ")
          : "Review the highlighted fields. Your saved draft is still private and unchanged.",
      type: "validation-applied",
    });
    setFinishOpen(false);
    window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
  }

  if (loading && !draft) {
    return <RecipeDraftLoadingView draftId={draftId} />;
  }

  function finishEditingForNow() {
    if (!onDoneForNow || !confirmNavigation()) return;
    setBlocked(false);
    onDoneForNow();
  }

  function closeFinishDialog() {
    if (publicationBusy) return;
    publicationDispatch({ type: "keep-editing" });
    setFinishOpen(false);
    window.setTimeout(() => finishTriggerRef.current?.focus(), 0);
  }

  if (!draft || !detail) {
    return (
      <main
        id="main-content"
        className="state-page draft-editor-page draft-editor-page--error"
      >
        <section
          className="error-state draft-editor-page__error blocking-error-state"
          role="alert"
        >
          <p className="eyebrow">Something went wrong</p>
          <h1>We couldn’t open this draft.</h1>
          <p>{loadError || "This private draft is unavailable."}</p>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void load()}
            >
              Try again
            </button>
            <GuardedLink
              className="button button--secondary"
              href="/account/recipes?view=drafts"
            >
              My recipes
            </GuardedLink>
          </div>
        </section>
      </main>
    );
  }

  const ingredientOptions = draftIngredientOptions(draft.ingredients);
  const editorDisabled = publicationBusy;
  const actionDisabled = pending !== null || publicationBusy;
  const isVersion = detail.source_version_id !== null;
  const workspaceHref = `/recipes/drafts/${encodeURIComponent(draftId)}`;
  const doneForNowHref = detail.source_version_id
    ? `/recipes/${encodeURIComponent(detail.source_version_id)}`
    : "/account/recipes?view=drafts";
  const finishLabel = isVersion ? "Publish draft" : "Finish recipe";
  const memberDisplayName = member?.display_name ?? "You";
  const resolvedFamilyRecipe = hasProvidedRecipeFamily
    ? familyRecipe
    : loadedRecipeFamily?.sourceVersionId === detail.source_version_id
      ? loadedRecipeFamily.recipe
      : undefined;
  const resolvedFamilyVersions = hasProvidedRecipeFamily
    ? familyVersions
    : loadedRecipeFamily?.sourceVersionId === detail.source_version_id
      ? loadedRecipeFamily.versions
      : undefined;
  const familyLoadStatus =
    !isVersion || resolvedFamilyRecipe
      ? "idle"
      : failedFamilySourceId === detail.source_version_id
        ? "failed"
        : "loading";
  const sourceRecipeTitle =
    resolvedFamilyRecipe?.title.trim() ||
    (familyLoadStatus === "failed"
      ? "Source recipe unavailable"
      : "Source recipe");
  const sourceRecipeTitlePending = isVersion && familyLoadStatus === "loading";

  const EditorPage = embedded ? "div" : "main";

  return (
    <EditorPage
      id={embedded ? undefined : "main-content"}
      className={
        embedded
          ? "recipe-draft-inline"
          : "page-shell page-shell--detail recipe-reading-page draft-editor-page draft-editor-page--ready recipe-workspace-page"
      }
    >
      <nav
        className="breadcrumb recipe-detail-breadcrumb"
        aria-label="Breadcrumb"
      >
        <GuardedLink href="/account/recipes?view=drafts">
          My recipes
        </GuardedLink>
        <span aria-hidden="true">/</span>
        <span aria-current="page">
          {draft.title.trim() ||
            (isVersion ? "Untitled version" : "Untitled recipe")}
        </span>
      </nav>
      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {domain.save.status === "saving" ? null : (
        <p className="visually-hidden" role="status" aria-live="polite">
          {editorStatus}
        </p>
      )}

      <form
        className="draft-editor draft-editor--authoring recipe-workspace__form"
        aria-label="Private recipe draft editor"
        noValidate
        onSubmit={(event) => void save(event)}
      >
        {formError ? (
          <div
            ref={errorSummaryRef}
            className="draft-editor__error-summary"
            role="alert"
            tabIndex={-1}
          >
            <h2>Your draft needs attention</h2>
            <p>{formError}</p>
            {Object.keys(fieldErrors).length ? (
              // prettier-ignore
              <p>{Object.keys(fieldErrors).length} field{Object.keys(fieldErrors).length === 1 ? " needs" : "s need"} attention.</p>
            ) : null}
            {conflict ? (
              <div className="button-row">
                <LoadingButton
                  className="button button--secondary"
                  type="button"
                  pending={loading}
                  pendingLabel="Reloading saved version…"
                  onClick={() => void reloadSavedVersion()}
                >
                  Reload saved version
                </LoadingButton>
                <a
                  className="button button--quiet"
                  href={workspaceHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open saved version in a new tab
                </a>
              </div>
            ) : null}
            {authenticationInterrupted ? (
              <a
                className="button button--secondary"
                href={`/sign-in?${new URLSearchParams({ return_to: workspaceHref }).toString()}`}
                target="_blank"
                rel="noreferrer"
              >
                Sign in again in a new tab
              </a>
            ) : null}
          </div>
        ) : null}

        <article className="recipe-detail recipe-workspace">
          <header className="recipe-detail__header recipe-workspace__header">
            <div className="recipe-detail__hero">
              <RecipeArtwork
                className="recipe-detail__artwork recipe-workspace__artwork"
                recipeKey={detail.source_version_id ?? draftId}
              />
              <div className="recipe-detail__intro recipe-workspace__intro">
                <div className="recipe-detail__label-row recipe-workspace__label-row">
                  <div className="recipe-detail__publication-meta">
                    <p className="eyebrow recipe-detail__version-badge">Draft</p>
                  </div>
                </div>
                <RecipeDraftIdentityFields
                  description={draft.description}
                  disabled={editorDisabled}
                  errors={fieldErrors}
                  onDescriptionChange={(description) =>
                    dispatch({
                      field: "description",
                      type: "text-field-changed",
                      value: description,
                    })
                  }
                  onTitleChange={(title) =>
                    dispatch({
                      field: "title",
                      type: "text-field-changed",
                      value: title,
                    })
                  }
                  isVersion={isVersion}
                  title={draft.title}
                  titleContext={
                    isVersion ? (
                      <p className="recipe-detail__parent-context">
                        Based on{" "}
                        <GuardedLink
                          href={`/recipes/${detail.source_version_id}`}
                        >
                          {sourceRecipeTitle}
                        </GuardedLink>
                        {resolvedFamilyRecipe ? (
                          <>
                            {" by "}
                            {resolvedFamilyRecipe.author.handle ? (
                              <GuardedLink
                                href={`/cooks/${encodeURIComponent(resolvedFamilyRecipe.author.handle)}`}
                              >
                                {resolvedFamilyRecipe.author.display_name}
                              </GuardedLink>
                            ) : (
                              <span>
                                {resolvedFamilyRecipe.author.display_name}
                              </span>
                            )}
                          </>
                        ) : null}
                      </p>
                    ) : undefined
                  }
                />
                <RecipeCategorySelector
                  disabled={editorDisabled}
                  error={fieldErrors.categories}
                  initialActiveCategories={initialCategories}
                  onChange={(categories) =>
                    dispatch({ categories, type: "categories-changed" })
                  }
                  presentation="recipe"
                  value={draft.categories}
                />
                <div className="recipe-detail__author-row recipe-workspace__author-row">
                  <div className="recipe-detail__author-identity">
                    <span
                      className="recipe-detail__author-avatar"
                      aria-hidden="true"
                    >
                      {authorInitial(memberDisplayName)}
                    </span>
                    <div className="recipe-detail__attribution">
                      <span>Recipe by</span>
                      <strong>{memberDisplayName}</strong>
                    </div>
                  </div>
                </div>
                <RecipeDraftFactsFields
                  activeTimeMinutes={draft.activeTimeMinutes}
                  difficulty={draft.difficulty}
                  disabled={editorDisabled}
                  errors={fieldErrors}
                  onActiveTimeMinutesChange={(activeTimeMinutes) =>
                    dispatch({
                      field: "activeTimeMinutes",
                      type: "text-field-changed",
                      value: activeTimeMinutes,
                    })
                  }
                  onDifficultyChange={(difficulty) =>
                    dispatch({ type: "difficulty-changed", value: difficulty })
                  }
                  onServingsChange={(servings) =>
                    dispatch({
                      field: "servings",
                      type: "text-field-changed",
                      value: servings,
                    })
                  }
                  onTotalTimeMinutesChange={(totalTimeMinutes) =>
                    dispatch({
                      field: "totalTimeMinutes",
                      type: "text-field-changed",
                      value: totalTimeMinutes,
                    })
                  }
                  servings={draft.servings}
                  totalTimeMinutes={draft.totalTimeMinutes}
                />
                <div className="recipe-detail__member-actions recipe-workspace__member-actions">
                  <div className="recipe-detail__social-row">
                    <RatingSummary average={null} count={0} />
                    <span className="recipe-detail__save-count">0 saves</span>
                  </div>
                  <div
                    className="recipe-action-strip recipe-workspace__action-strip"
                    aria-label="Draft actions"
                  >
                    <LoadingButton
                      className="recipe-action-button"
                      type="submit"
                      disabled={publicationBusy || !dirty}
                      pending={pending === "save"}
                      pendingLabel="Saving…"
                    >
                      {dirty ? "Save draft" : "Draft saved"}
                    </LoadingButton>
                    {onDoneForNow ? (
                      <button
                        className="recipe-action-button"
                        type="button"
                        onClick={finishEditingForNow}
                      >
                        Return
                      </button>
                    ) : (
                      <GuardedLink
                        className="recipe-action-button"
                        href={doneForNowHref}
                      >
                        Return
                      </GuardedLink>
                    )}
                    <LoadingButton
                      ref={finishTriggerRef}
                      className="recipe-action-button recipe-action-button--primary"
                      type="button"
                      aria-controls="recipe-workspace-finish"
                      aria-expanded={finishOpen}
                      aria-haspopup="dialog"
                      disabled={actionDisabled}
                      pending={sourceRecipeTitlePending}
                      pendingLabel="Loading source recipe…"
                      onClick={() => setFinishOpen(true)}
                    >
                      {finishLabel}
                    </LoadingButton>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <RecipeDetailTabs
            recipe={
              <div className="recipe-detail__body recipe-workspace__body">
                <RecipeDraftIngredientsSection
                  disabled={editorDisabled}
                  errors={fieldErrors}
                  ingredients={draft.ingredients}
                  measurementUnits={measurementUnits}
                  onAdd={addIngredient}
                  onMove={moveIngredient}
                  onRemove={removeIngredient}
                  onMeasureChange={(key, measure) =>
                    dispatch({
                      key,
                      measure,
                      type: "ingredient-measure-changed",
                    })
                  }
                  onNotesChange={(key, notes) =>
                    dispatch({ key, notes, type: "ingredient-notes-changed" })
                  }
                  onSelectionChange={(key, selection) =>
                    dispatch({
                      key,
                      selection,
                      type: "ingredient-selection-changed",
                    })
                  }
                />
                <RecipeDraftInstructionsSection
                  actionTypes={actionTypes}
                  disabled={editorDisabled}
                  errors={fieldErrors}
                  ingredientOptions={ingredientOptions}
                  instructions={draft.instructions}
                  measurementUnits={measurementUnits}
                  onAdd={addInstruction}
                  onMove={moveInstruction}
                  onRemove={removeInstruction}
                  onActionsChange={(key, actions) =>
                    dispatch({
                      actions,
                      key,
                      type: "instruction-actions-changed",
                    })
                  }
                  onTextChange={(key, text) =>
                    dispatch({ key, text, type: "instruction-text-changed" })
                  }
                  onTitleChange={(key, title) =>
                    dispatch({
                      key,
                      title,
                      type: "instruction-title-changed",
                    })
                  }
                />
              </div>
            }
            notes={
              <RecipeDraftNotesSection
                disabled={editorDisabled}
                error={fieldErrors.notes}
                notes={draft.notes}
                onChange={(notes) =>
                  dispatch({
                    field: "notes",
                    type: "text-field-changed",
                    value: notes,
                  })
                }
              />
            }
            family={
              detail.source_version_id !== null && resolvedFamilyRecipe ? (
                <RecipeFamilyNavigator
                  draftPreview={{
                    authorDisplayName: memberDisplayName,
                    id: draftId,
                    parentVersionId: detail.source_version_id,
                    title: draft.title.trim() || "Untitled version",
                  }}
                  recipe={resolvedFamilyRecipe}
                  versions={resolvedFamilyVersions}
                />
              ) : (
                <section
                  id="recipe-family"
                  className="recipe-workspace__family"
                  aria-labelledby="recipe-workspace-family-title"
                >
                  <h2 id="recipe-workspace-family-title">Recipe family</h2>
                  {isVersion && familyLoadStatus === "loading" ? (
                    <SectionLoading
                      count={3}
                      label="Loading recipe family…"
                      layout="cards"
                    />
                  ) : (
                    <p role={isVersion ? "status" : undefined}>
                      {isVersion
                        ? "The recipe family is temporarily unavailable. Your private draft is still safe."
                        : "This recipe will start a new family after you publish it."}
                    </p>
                  )}
                </section>
              )
            }
          />

          <Dialog
                backdropClassName="recipe-workspace__finish-backdrop"
                id="recipe-workspace-finish"
                className="recipe-workspace__finish-panel"
                aria-labelledby="recipe-workspace-finish-title"
                aria-describedby="recipe-workspace-finish-summary"
                dismissible={!publicationBusy}
                open={finishOpen}
                restoreFocusRef={finishTriggerRef}
                onOpenChange={(open) => {
                  if (!open) closeFinishDialog();
                }}
              >
                <div className="recipe-workspace__finish-heading">
                  <div>
                    <p className="eyebrow">
                      {isVersion ? "Publish version" : "Publish recipe"}
                    </p>
                    <h2 id="recipe-workspace-finish-title">
                      Ready to share your {isVersion ? "version" : "recipe"}?
                    </h2>
                  </div>
                  <button
                    autoFocus
                    className="recipe-workspace__finish-close"
                    type="button"
                    aria-label="Close publish dialog"
                    disabled={publicationBusy}
                    onClick={closeFinishDialog}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </div>
                <RecipeDraftPublication
                  actionTypes={actionTypes}
                  draft={draft}
                  draftId={draftId}
                  dirty={dirty}
                  measurementUnits={measurementUnits}
                  onRequestClose={closeFinishDialog}
                  onValidation={applyPublicationValidation}
                  publicationDispatch={publicationDispatch}
                  publicationState={publicationState}
                  revision={detail.revision}
                  sourceRecipeTitle={sourceRecipeTitle}
                  sourceVersionId={detail.source_version_id}
                />
          </Dialog>
        </article>
      </form>
    </EditorPage>
  );
}

export function RecipeDraftEditor(props: RecipeDraftEditorProps) {
  const returnTo = `/recipes/drafts/${props.draftId}`;
  return (
    <MemberRouteGate
      cardClassName="recipe-authoring-state__panel"
      eyebrow="Private recipe workspace"
      pageClassName="recipe-authoring-state recipe-authoring-state--gate"
      returnTo={returnTo}
      title="Recipe draft editor"
    >
      <RecipeDraftEditorInner {...props} />
    </MemberRouteGate>
  );
}
