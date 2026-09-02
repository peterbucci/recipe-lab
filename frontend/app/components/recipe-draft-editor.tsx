"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { AuthApiError } from "../../lib/auth-api";
import type { CatalogActionType } from "../../lib/cooking-action-api";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import type {
  RecipeCardSummary,
  RecipeCategory,
  RecipeDetail,
  RecipePage,
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
  type RecipeDraftEditorState,
  type RecipeDraftIngredientState,
  type RecipeDraftInstructionState,
  type RecipeDraftValidation,
  validateRecipeDraft,
} from "../../lib/recipe-draft";
import {
  appendDraftIngredient,
  appendDraftInstruction,
  moveDraftIngredient,
  moveDraftInstruction,
  removeDraftIngredient,
  removeDraftInstruction,
  replaceDraftIngredient,
  replaceDraftInstruction,
} from "../../lib/recipe-draft-editor-transforms";
import {
  type DraftFailureKind,
  initialRecipeDraftEditorDomainState,
  prepareDraftSaveAttempt,
  recipeDraftEditorIsDirty,
  recipeDraftEditorReducer,
} from "../../lib/recipe-draft-editor-state";
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

interface LoadedRecipeFamily {
  recipe: RecipeDetail;
  sourceVersionId: string;
  versions: readonly RecipeCardSummary[];
}

async function fetchRecipeFamily(
  sourceVersionId: string,
  signal: AbortSignal,
): Promise<LoadedRecipeFamily> {
  const recipeResponse = await fetch(
    `/api/recipes/${encodeURIComponent(sourceVersionId)}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  if (!recipeResponse.ok) throw new Error("Recipe family unavailable");
  const recipe = (await recipeResponse.json()) as RecipeDetail;
  const query = new URLSearchParams({
    lineage_id: recipe.lineage_id,
    page: "1",
    page_size: "100",
    sort: "title",
  });
  let versions: readonly RecipeCardSummary[] = [];
  try {
    const familyResponse = await fetch(`/api/recipes?${query.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (familyResponse.ok) {
      const family = (await familyResponse.json()) as RecipePage;
      versions = family.items;
    }
  } catch (reason) {
    if (
      signal.aborted ||
      (reason instanceof DOMException && reason.name === "AbortError")
    ) {
      throw reason;
    }
  }
  return {
    recipe,
    sourceVersionId,
    versions,
  };
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
  const [loading, setLoading] = useState(initialDetail === undefined);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState("");
  const [finishOpen, setFinishOpen] = useState(false);
  const [loadedRecipeFamily, setLoadedRecipeFamily] =
    useState<LoadedRecipeFamily | null>(null);
  const [failedFamilySourceId, setFailedFamilySourceId] = useState<
    string | null
  >(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const finishTriggerRef = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const pendingFocusId = useRef<string | null>(null);
  const latestDraftFingerprint = useRef(
    domain.work.status === "unavailable"
      ? ""
      : recipeDraftFingerprint(domain.work.draft),
  );
  const loadRequestToken = useRef(0);

  const work = domain.work.status === "unavailable" ? null : domain.work;
  const detail = work?.detail ?? null;
  const draft = work?.draft ?? null;
  const dirty = recipeDraftEditorIsDirty(domain);
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
        setFieldErrors({});
        setFormError("");
        return "loaded";
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError")
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
        setFieldErrors({});
        setFormError("");
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
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
          (reason instanceof DOMException && reason.name === "AbortError")
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

  useEffect(() => {
    if (!pendingFocusId.current) return;
    document.getElementById(pendingFocusId.current)?.focus();
    pendingFocusId.current = null;
  }, [draft]);

  function change(next: RecipeDraftEditorState) {
    latestDraftFingerprint.current = recipeDraftFingerprint(next);
    dispatch({ draft: next, type: "draft-changed" });
    setFormError("");
  }

  function replaceIngredient(
    key: string,
    ingredient: RecipeDraftIngredientState,
  ) {
    if (!draft) return;
    change(replaceDraftIngredient(draft, key, ingredient));
  }

  function replaceInstruction(
    key: string,
    instruction: RecipeDraftInstructionState,
  ) {
    if (!draft) return;
    change(replaceDraftInstruction(draft, key, instruction));
  }

  function addIngredient() {
    if (!draft || draft.ingredients.length >= 200) return;
    const row = createDraftIngredientState();
    pendingFocusId.current = `draft-${row.key}-ingredient-search`;
    change(appendDraftIngredient(draft, row));
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
    const next = removeDraftIngredient(draft, index);
    if (next === draft) return;
    const focus =
      next.ingredients[Math.min(index, next.ingredients.length - 1)];
    pendingFocusId.current = focus
      ? `draft-${focus.key}-ingredient-search`
      : "draft-add-ingredient";
    change(next);
    setAnnouncement(`Removed ingredient ${index + 1}.`);
  }

  function moveIngredient(index: number, direction: -1 | 1) {
    if (!draft) return;
    const destination = index + direction;
    if (destination < 0 || destination >= draft.ingredients.length) return;
    const moved = draft.ingredients[index];
    if (!moved) return;
    const next = moveDraftIngredient(draft, index, direction);
    if (next === draft) return;
    pendingFocusId.current = `draft-${moved.key}-ingredient-move-${direction < 0 ? "up" : "down"}`;
    change(next);
    setAnnouncement(
      `Moved ingredient to position ${destination + 1} of ${next.ingredients.length}.`,
    );
  }

  function addInstruction() {
    if (!draft || draft.instructions.length >= 100) return;
    const row = createDraftInstructionState();
    pendingFocusId.current = `draft-${row.key}-instruction-text`;
    change(appendDraftInstruction(draft, row));
    setAnnouncement(`Added instruction ${draft.instructions.length + 1}.`);
  }

  function removeInstruction(index: number) {
    if (!draft) return;
    const next = removeDraftInstruction(draft, index);
    if (next === draft) return;
    const focus =
      next.instructions[Math.min(index, next.instructions.length - 1)];
    pendingFocusId.current = focus
      ? `draft-${focus.key}-instruction-text`
      : "draft-add-instruction";
    change(next);
    setAnnouncement(`Removed instruction ${index + 1}.`);
  }

  function moveInstruction(index: number, direction: -1 | 1) {
    if (!draft) return;
    const destination = index + direction;
    if (destination < 0 || destination >= draft.instructions.length) return;
    const moved = draft.instructions[index];
    if (!moved) return;
    const next = moveDraftInstruction(draft, index, direction);
    if (next === draft) return;
    pendingFocusId.current = `draft-${moved.key}-instruction-move-${direction < 0 ? "up" : "down"}`;
    change(next);
    setAnnouncement(
      `Moved instruction to position ${destination + 1} of ${next.instructions.length}.`,
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !detail || pendingRef.current || pending) return;
    const validation = validateRecipeDraft(
      draft,
      detail.revision,
      measurementUnits,
      actionTypes,
    );
    setFieldErrors(validation.fieldErrors);
    if (!validation.payload) {
      setFormError(
        "Review the highlighted fields. Your draft has not been changed on the server.",
      );
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return;
    }
    const currentFingerprint = recipeDraftFingerprint(draft);
    const attempt = prepareDraftSaveAttempt(domain, {
      fingerprint: currentFingerprint,
      newIdempotencyKey: createIdempotencyKey(),
      revision: detail.revision,
    });
    pendingRef.current = true;
    dispatch({ attempt, type: "save-started" });
    setFormError("");
    try {
      const saved = await updateRecipeDraft(
        draftId,
        validation.payload,
        attempt.idempotencyKey,
      );
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
      setFieldErrors({});
    } catch (reason) {
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
        setFieldErrors(serverFieldErrors);
        setFormError(
          "Review the highlighted fields. Your edits are still here.",
        );
      } else if (kind === "revision-conflict") {
        setFormError(
          "This draft changed in another tab. Your unsaved version is still here.",
        );
      } else if (kind === "authentication-interruption") {
        setFormError(
          "Your session expired. Your edits are still here. Sign in again before saving.",
        );
      } else {
        setFormError(
          "Recipe Lab could not save this draft. Your edits are still here.",
        );
      }
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    } finally {
      pendingRef.current = false;
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
    setFieldErrors(validation.fieldErrors);
    if (validation.payload) {
      setFormError("");
      if (draft) dispatch({ draft, type: "draft-changed" });
      return;
    }
    setFormError(
      validation.formErrors.length > 0
        ? validation.formErrors.join(" ")
        : "Review the highlighted fields. Your saved draft is still private and unchanged.",
    );
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
                    change({ ...draft, description })
                  }
                  onTitleChange={(title) => change({ ...draft, title })}
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
                  onChange={(categories) => change({ ...draft, categories })}
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
                    change({ ...draft, activeTimeMinutes })
                  }
                  onDifficultyChange={(difficulty) =>
                    change({ ...draft, difficulty })
                  }
                  onServingsChange={(servings) =>
                    change({ ...draft, servings })
                  }
                  onTotalTimeMinutesChange={(totalTimeMinutes) =>
                    change({ ...draft, totalTimeMinutes })
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
                  onReplace={replaceIngredient}
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
                  onReplace={replaceInstruction}
                />
              </div>
            }
            notes={
              <RecipeDraftNotesSection
                disabled={editorDisabled}
                error={fieldErrors.notes}
                notes={draft.notes}
                onChange={(notes) => change({ ...draft, notes })}
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
                  onBusyChange={setPublicationBusy}
                  onRequestClose={closeFinishDialog}
                  onValidation={applyPublicationValidation}
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
