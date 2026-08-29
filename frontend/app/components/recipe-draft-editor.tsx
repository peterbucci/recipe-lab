"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { AuthApiError } from "../../lib/auth-api";
import type { CatalogActionType } from "../../lib/cooking-action-api";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  discardRecipeDraft,
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
import { MemberRouteGate } from "./member-route-gate";
import { GuardedLink, useNavigationBlocker } from "./navigation-blocker-provider";
import { RecipeDraftDetailsSection } from "./recipe-draft-details-section";
import { RecipeDraftDiscardSection } from "./recipe-draft-discard-section";
import { RecipeDraftPublication } from "./recipe-draft-publication";
import { RecipeDraftIngredientsSection } from "./recipe-draft-ingredients-section";
import { RecipeDraftInstructionsSection } from "./recipe-draft-instructions-section";

interface RecipeDraftEditorProps {
  actionTypes: readonly CatalogActionType[];
  draftId: string;
  measurementUnits: readonly CatalogUnit[];
}

interface SaveAttempt {
  fingerprint: string;
  idempotencyKey: string;
  revision: number;
}

function draftLoadErrorMessage(reason: unknown): string {
  if (reason instanceof RecipeDraftApiError && reason.status === 404) {
    return "This private draft was not found. It may have been discarded, or it may belong to another account.";
  }
  return "Recipe Lab could not open this private draft. Please try again.";
}

function RecipeDraftEditorInner({ draftId, measurementUnits, actionTypes }: RecipeDraftEditorProps) {
  const router = useRouter();
  const { setBlocked } = useNavigationBlocker();
  const [detail, setDetail] = useState<RecipeDraftDetail | null>(null);
  const [draft, setDraft] = useState<RecipeDraftEditorState | null>(null);
  const draftRef = useRef<RecipeDraftEditorState | null>(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"save" | "discard" | null>(null);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const saveAttempt = useRef<SaveAttempt | null>(null);
  const discardAttempt = useRef<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const pendingFocusId = useRef<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError("");
    try {
      const loaded = await fetchRecipeDraft(draftId, signal);
      const state = hydrateRecipeDraft(loaded);
      setDetail(loaded);
      draftRef.current = state;
      setDraft(state);
      setBaseline(recipeDraftFingerprint(state));
      setFieldErrors({});
      setFormError("");
      setConflict(false);
      return true;
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return false;
      setLoadError(draftLoadErrorMessage(reason));
      return false;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchRecipeDraft(draftId, controller.signal)
      .then((loaded) => {
        const state = hydrateRecipeDraft(loaded);
        setDetail(loaded);
        draftRef.current = state;
        setDraft(state);
        setBaseline(recipeDraftFingerprint(state));
        setFieldErrors({});
        setFormError("");
        setConflict(false);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setLoadError(draftLoadErrorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [draftId]);

  const fingerprint = draft ? recipeDraftFingerprint(draft) : "";
  const dirty = draft !== null && baseline !== "" && fingerprint !== baseline;

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
    draftRef.current = next;
    setDraft(next);
    setStatus("");
    setFormError("");
    setConflict(false);
  }

  function replaceIngredient(key: string, ingredient: RecipeDraftIngredientState) {
    if (!draft) return;
    change(replaceDraftIngredient(draft, key, ingredient));
  }

  function replaceInstruction(key: string, instruction: RecipeDraftInstructionState) {
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
    const next = removeDraftIngredient(draft, index);
    if (next === draft) return;
    const focus = next.ingredients[Math.min(index, next.ingredients.length - 1)];
    pendingFocusId.current = focus ? `draft-${focus.key}-ingredient-search` : "draft-add-ingredient";
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
    setAnnouncement(`Moved ingredient to position ${destination + 1} of ${next.ingredients.length}.`);
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
    const focus = next.instructions[Math.min(index, next.instructions.length - 1)];
    pendingFocusId.current = focus ? `draft-${focus.key}-instruction-text` : "draft-add-instruction";
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
    setAnnouncement(`Moved instruction to position ${destination + 1} of ${next.instructions.length}.`);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !detail || pendingRef.current || pending) return;
    const validation = validateRecipeDraft(draft, detail.revision, measurementUnits, actionTypes);
    setFieldErrors(validation.fieldErrors);
    if (!validation.payload) {
      setFormError("Review the highlighted fields. Your draft has not been changed on the server.");
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return;
    }
    const currentFingerprint = recipeDraftFingerprint(draft);
    const attempt =
      saveAttempt.current?.fingerprint === currentFingerprint && saveAttempt.current.revision === detail.revision
        ? saveAttempt.current
        : { fingerprint: currentFingerprint, revision: detail.revision, idempotencyKey: createIdempotencyKey() };
    saveAttempt.current = attempt;
    pendingRef.current = true;
    setPending("save");
    setFormError("");
    setConflict(false);
    setStatus("Saving your private draft…");
    try {
      const saved = await updateRecipeDraft(
        draftId,
        validation.payload,
        attempt.idempotencyKey,
      );
      const savedState = hydrateRecipeDraft(saved);
      const savedFingerprint = recipeDraftFingerprint(savedState);
      const latestDraft = draftRef.current;
      const hasNewerLocalWork =
        latestDraft !== null && recipeDraftFingerprint(latestDraft) !== attempt.fingerprint;
      saveAttempt.current = null;
      setDetail(saved);
      setBaseline(savedFingerprint);
      if (!hasNewerLocalWork) {
        draftRef.current = savedState;
        setDraft(savedState);
      }
      setFieldErrors({});
      setStatus(
        hasNewerLocalWork
          ? "Earlier changes saved. Your newer edits are still unsaved."
          : "Draft saved privately.",
      );
    } catch (reason) {
      setStatus("");
      if (reason instanceof RecipeDraftApiError && reason.code === "recipe_draft_revision_conflict") {
        setConflict(true);
        setFormError("This draft changed in another tab. Your unsaved version is still here.");
      } else if (
        (reason instanceof RecipeDraftApiError || reason instanceof AuthApiError) &&
        reason.status === 401
      ) {
        setFormError("Your session expired. Your edits are still here. Sign in again before saving.");
      } else {
        setFormError("Recipe Lab could not save this draft. Your edits are still here.");
      }
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  async function reloadSavedVersion() {
    if (!window.confirm("Replace your unsaved version with the latest saved version?")) return;
    if (await load()) setStatus("Loaded the latest saved version.");
  }

  async function discard() {
    if (!detail || pendingRef.current || pending) return;
    const key = discardAttempt.current ?? createIdempotencyKey();
    discardAttempt.current = key;
    pendingRef.current = true;
    setPending("discard");
    setFormError("");
    try {
      await discardRecipeDraft(draftId, detail.revision, key);
      setBlocked(false);
      router.replace("/account/recipes?view=drafts");
    } catch (reason) {
      if (reason instanceof RecipeDraftApiError && reason.code === "recipe_draft_revision_conflict") {
        setConflict(true);
        setFormError("This draft changed in another tab. It was not discarded, and your version is still here.");
      } else if (
        (reason instanceof RecipeDraftApiError || reason instanceof AuthApiError) &&
        reason.status === 401
      ) {
        setFormError("Your session expired. This draft was not discarded. Sign in again to continue.");
      } else {
        setFormError("Recipe Lab could not discard this draft. It is still private and intact.");
      }
      pendingRef.current = false;
      setPending(null);
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    }
  }

  function applyPublicationValidation(validation: RecipeDraftValidation) {
    setFieldErrors(validation.fieldErrors);
    if (validation.payload) {
      setFormError("");
      setConflict(false);
      return;
    }
    setFormError(
      validation.formErrors.length > 0
        ? validation.formErrors.join(" ")
        : "Review the highlighted fields. Your saved draft is still private and unchanged.",
    );
    window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
  }

  if (loading && !draft) {
    return <main id="main-content" className="state-page"><p role="status">Loading your private draft…</p></main>;
  }
  if (loadError || !draft || !detail) {
    return (
      <main id="main-content" className="state-page">
        <section className="error-state" role="alert">
          <p className="eyebrow">Private draft unavailable</p>
          <h1>We couldn’t open this draft.</h1>
          <p>{loadError || "This private draft is unavailable."}</p>
          <div className="button-row">
            <button className="button button--primary" type="button" onClick={() => void load()}>Try again</button>
            <GuardedLink className="button button--secondary" href="/account/recipes?view=drafts">My recipes</GuardedLink>
          </div>
        </section>
      </main>
    );
  }

  const ingredientOptions = draftIngredientOptions(draft.ingredients);
  const editorDisabled = pending === "discard" || publicationBusy;
  const actionDisabled = pending !== null || publicationBusy;

  return (
    <main id="main-content" className="page-shell page-shell--detail draft-editor-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <GuardedLink href="/account/recipes?view=drafts">← My recipes</GuardedLink>
      </nav>
      <header className="page-intro page-intro--editor">
        <p className="eyebrow">{detail.source_version_id ? "Private version draft" : "Private original recipe draft"}</p>
        <h1>{draft.title.trim() || "Untitled recipe"}</h1>
        <p>
          Save incomplete work as often as you like. Nothing here is public.
          {detail.source_version_id ? (
            <> This draft is based on <GuardedLink href={`/recipes/${detail.source_version_id}`}>the public recipe you started from</GuardedLink>.</>
          ) : null}
        </p>
      </header>

      <p className="draft-editor__privacy">
        <strong>Private draft</strong> · Only you can see it. Publishing creates a separate public
        recipe version.
      </p>
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>

      <form className="draft-editor" aria-label="Private recipe draft editor" noValidate onSubmit={(event) => void save(event)}>
        {formError ? (
          <div ref={errorSummaryRef} className="draft-editor__error-summary" role="alert" tabIndex={-1}>
            <h2>Your draft was not saved</h2>
            <p>{formError}</p>
            {Object.keys(fieldErrors).length ? <p>{Object.keys(fieldErrors).length} field{Object.keys(fieldErrors).length === 1 ? " needs" : "s need"} attention.</p> : null}
            {conflict ? (
              <div className="button-row">
                <button className="button button--secondary" type="button" onClick={() => void reloadSavedVersion()}>Reload saved version</button>
                <a className="button button--quiet" href={`/account/recipe-drafts/${draftId}`} target="_blank" rel="noreferrer">Open saved version in a new tab</a>
              </div>
            ) : null}
            {formError.includes("session expired") ? (
              <a className="button button--secondary" href={`/sign-in?${new URLSearchParams({ return_to: `/account/recipe-drafts/${draftId}` }).toString()}`} target="_blank" rel="noreferrer">Sign in again in a new tab</a>
            ) : null}
          </div>
        ) : null}

        <RecipeDraftDetailsSection
          description={draft.description}
          disabled={editorDisabled}
          errors={fieldErrors}
          onDescriptionChange={(description) => change({ ...draft, description })}
          onServingsChange={(servings) => change({ ...draft, servings })}
          onTitleChange={(title) => change({ ...draft, title })}
          servings={draft.servings}
          title={draft.title}
        />

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

        <RecipeDraftPublication
          actionTypes={actionTypes}
          draft={draft}
          draftId={draftId}
          dirty={dirty}
          measurementUnits={measurementUnits}
          onBusyChange={setPublicationBusy}
          onValidation={applyPublicationValidation}
          revision={detail.revision}
          sourceVersionId={detail.source_version_id}
        />

        <div className="draft-editor__actions">
          <div>
            <button className="button button--primary" type="submit" disabled={actionDisabled || !dirty}>{pending === "save" ? "Saving…" : dirty ? "Save draft" : "Draft saved"}</button>
            <GuardedLink className="button button--secondary" href="/account/recipes?view=drafts">Back to drafts</GuardedLink>
          </div>
          <p role="status" aria-live="polite">{status || (dirty ? "You have unsaved changes." : "All changes are saved privately.")}</p>
        </div>

        <RecipeDraftDiscardSection
          confirming={confirmDiscard}
          disabled={actionDisabled}
          discarding={pending === "discard"}
          onCancel={() => setConfirmDiscard(false)}
          onConfirm={discard}
          onRequest={() => setConfirmDiscard(true)}
        />
      </form>
    </main>
  );
}

export function RecipeDraftEditor(props: RecipeDraftEditorProps) {
  const returnTo = `/account/recipe-drafts/${props.draftId}`;
  return (
    <MemberRouteGate eyebrow="Private recipe workspace" returnTo={returnTo} title="Recipe draft editor">
      <RecipeDraftEditorInner {...props} />
    </MemberRouteGate>
  );
}
