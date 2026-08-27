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
import type { CatalogIngredientSelection } from "../../lib/ingredient-catalog-api";
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
  draftIngredientFieldKey,
  draftIngredientMeasureFieldKey,
  draftIngredientOptions,
  draftInstructionActionFieldKey,
  draftInstructionFieldKey,
  hydrateRecipeDraft,
  recipeDraftFingerprint,
  requestSelectionFromSubmission,
  type RecipeDraftEditorState,
  type RecipeDraftIngredientState,
  type RecipeDraftInstructionState,
  type RecipeDraftValidation,
  validateRecipeDraft,
} from "../../lib/recipe-draft";
import type { StructuredMeasureField } from "../../lib/structured-measure";
import { MemberRouteGate } from "./member-route-gate";
import { IngredientCatalogPicker } from "./ingredient-catalog-picker";
import { GuardedLink, useNavigationBlocker } from "./navigation-blocker-provider";
import { RecipeDraftPublication } from "./recipe-draft-publication";
import { StructuredActionEditor } from "./structured-action-editor";
import { IngredientAmountControl } from "./structured-measure-control";

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

const DISCARD_COPY =
  "Discard permanently deletes this draft and its private content immediately. It cannot be restored.";

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="variant-field-error">{message}</p> : null;
}

function ingredientMeasureErrors(
  errors: Readonly<Record<string, string>>,
  key: string,
): Partial<Record<StructuredMeasureField, string>> {
  const fields: StructuredMeasureField[] = ["mode", "amount", "minimum", "maximum", "unit"];
  return Object.fromEntries(fields.flatMap((field) => {
    const message = errors[draftIngredientMeasureFieldKey(key, field)];
    return message ? [[field, message]] : [];
  }));
}

function instructionActionErrors(
  errors: Readonly<Record<string, string>>,
  key: string,
): Record<string, string> {
  const prefix = draftInstructionActionFieldKey(key, "");
  return Object.fromEntries(
    Object.entries(errors).flatMap(([field, message]) =>
      field.startsWith(prefix) ? [[field.slice(prefix.length), message]] : [],
    ),
  );
}

function requestStatusLabel(status: string): string {
  if (status === "approved") return "Approved";
  if (status === "duplicate") return "Matched to catalog";
  if (status === "rejected") return "Not approved";
  return "Awaiting curator review";
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
      setLoadError(
        reason instanceof RecipeDraftApiError && reason.status === 404
          ? "This private draft was not found. It may have been discarded, or it may belong to another account."
          : reason instanceof RecipeDraftApiError
            ? reason.message
          : "Recipe Lab could not open this private draft. Please try again.",
      );
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
        setLoadError(
          reason instanceof RecipeDraftApiError && reason.status === 404
            ? "This private draft was not found. It may have been discarded, or it may belong to another account."
            : reason instanceof RecipeDraftApiError
              ? reason.message
              : "Recipe Lab could not open this private draft. Please try again.",
        );
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
    change({ ...draft, ingredients: draft.ingredients.map((row) => row.key === key ? ingredient : row) });
  }

  function replaceInstruction(key: string, instruction: RecipeDraftInstructionState) {
    if (!draft) return;
    change({ ...draft, instructions: draft.instructions.map((row) => row.key === key ? instruction : row) });
  }

  function addIngredient() {
    if (!draft || draft.ingredients.length >= 200) return;
    const row = createDraftIngredientState();
    pendingFocusId.current = `draft-${row.key}-ingredient-search`;
    change({ ...draft, ingredients: [...draft.ingredients, row] });
    setAnnouncement(`Added ingredient ${draft.ingredients.length + 1}.`);
  }

  function removeIngredient(index: number) {
    if (!draft) return;
    const row = draft.ingredients[index];
    if (!row) return;
    const next = draft.ingredients.filter((_, rowIndex) => rowIndex !== index);
    const focus = next[Math.min(index, next.length - 1)];
    pendingFocusId.current = focus ? `draft-${focus.key}-ingredient-search` : "draft-add-ingredient";
    change({
      ...draft,
      ingredients: next,
      instructions: draft.instructions.map((instruction) => ({
        ...instruction,
        actions: instruction.actions.map((action) => ({
          ...action,
          ingredientKeys: action.ingredientKeys.filter((key) => key !== row.key),
        })),
      })),
    });
    setAnnouncement(`Removed ingredient ${index + 1}.`);
  }

  function moveIngredient(index: number, direction: -1 | 1) {
    if (!draft) return;
    const destination = index + direction;
    if (destination < 0 || destination >= draft.ingredients.length) return;
    const next = [...draft.ingredients];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(destination, 0, moved);
    pendingFocusId.current = `draft-${moved.key}-ingredient-move-${direction < 0 ? "up" : "down"}`;
    change({ ...draft, ingredients: next });
    setAnnouncement(`Moved ingredient to position ${destination + 1} of ${next.length}.`);
  }

  function addInstruction() {
    if (!draft || draft.instructions.length >= 100) return;
    const row = createDraftInstructionState();
    pendingFocusId.current = `draft-${row.key}-instruction-text`;
    change({ ...draft, instructions: [...draft.instructions, row] });
    setAnnouncement(`Added instruction ${draft.instructions.length + 1}.`);
  }

  function removeInstruction(index: number) {
    if (!draft) return;
    const next = draft.instructions.filter((_, rowIndex) => rowIndex !== index);
    const focus = next[Math.min(index, next.length - 1)];
    pendingFocusId.current = focus ? `draft-${focus.key}-instruction-text` : "draft-add-instruction";
    change({ ...draft, instructions: next });
    setAnnouncement(`Removed instruction ${index + 1}.`);
  }

  function moveInstruction(index: number, direction: -1 | 1) {
    if (!draft) return;
    const destination = index + direction;
    if (destination < 0 || destination >= draft.instructions.length) return;
    const next = [...draft.instructions];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(destination, 0, moved);
    pendingFocusId.current = `draft-${moved.key}-instruction-move-${direction < 0 ? "up" : "down"}`;
    change({ ...draft, instructions: next });
    setAnnouncement(`Moved instruction to position ${destination + 1} of ${next.length}.`);
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
        setFormError(
          reason instanceof RecipeDraftApiError || reason instanceof AuthApiError
            ? reason.message
            : "Recipe Lab could not save this draft. Your edits are still here.",
        );
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
      router.replace("/account/recipe-drafts");
    } catch (reason) {
      if (reason instanceof RecipeDraftApiError && reason.code === "recipe_draft_revision_conflict") {
        setConflict(true);
        setFormError("This draft changed in another tab. It was not discarded, and your version is still here.");
      } else {
        setFormError(
          reason instanceof RecipeDraftApiError || reason instanceof AuthApiError
            ? reason.message
            : "Recipe Lab could not discard this draft. It is still private and intact.",
        );
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
            <GuardedLink className="button button--secondary" href="/account/recipe-drafts">My recipe drafts</GuardedLink>
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
        <GuardedLink href="/account/recipe-drafts">← My recipe drafts</GuardedLink>
      </nav>
      <header className="page-intro page-intro--editor">
        <p className="eyebrow">{detail.source_version_id ? "Private fork draft" : "Private original draft"}</p>
        <h1>{draft.title.trim() || "Untitled recipe"}</h1>
        <p>
          Save incomplete work as often as you like. Nothing here is public.
          {detail.source_version_id ? (
            <> This draft stays connected to its <GuardedLink href={`/recipes/${detail.source_version_id}`}>exact public source version</GuardedLink>.</>
          ) : null}
        </p>
      </header>

      <p className="draft-editor__privacy">
        <strong>Private draft</strong> · Revision {detail.revision}. Publishing creates a separate
        immutable public snapshot.
      </p>
      <p className="visually-hidden" role="status" aria-live="polite">{announcement}</p>

      <form className="variant-editor draft-editor" aria-label="Private recipe draft editor" noValidate onSubmit={(event) => void save(event)}>
        {formError ? (
          <div ref={errorSummaryRef} className="variant-error-summary" role="alert" tabIndex={-1}>
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

        <fieldset className="variant-editor__section" disabled={editorDisabled}>
          <legend>Recipe details</legend>
          <p className="variant-editor__help">A private draft may be untitled and incomplete.</p>
          <div className="draft-editor__details-grid">
            <div className="variant-field draft-editor__title-field">
              <label htmlFor="draft-title">Title</label>
              <input id="draft-title" value={draft.title} maxLength={200} aria-invalid={Boolean(fieldErrors.title)} aria-describedby={fieldErrors.title ? "draft-title-error" : undefined} onChange={(event) => change({ ...draft, title: event.target.value })} />
              <FieldError id="draft-title-error" message={fieldErrors.title} />
            </div>
            <div className="variant-field">
              <label htmlFor="draft-servings">Servings</label>
              <input id="draft-servings" value={draft.servings} inputMode="decimal" aria-invalid={Boolean(fieldErrors.servings)} aria-describedby={fieldErrors.servings ? "draft-servings-error" : undefined} onChange={(event) => change({ ...draft, servings: event.target.value })} />
              <FieldError id="draft-servings-error" message={fieldErrors.servings} />
            </div>
            <div className="variant-field draft-editor__description-field">
              <label htmlFor="draft-description">Description</label>
              <textarea id="draft-description" value={draft.description} maxLength={2000} rows={4} aria-invalid={Boolean(fieldErrors.description)} aria-describedby={fieldErrors.description ? "draft-description-error" : undefined} onChange={(event) => change({ ...draft, description: event.target.value })} />
              <FieldError id="draft-description-error" message={fieldErrors.description} />
            </div>
          </div>
        </fieldset>

        <fieldset className="variant-editor__section" disabled={editorDisabled}>
          <legend>Ingredients</legend>
          <p className="variant-editor__help">Use trusted catalog identities. A submitted request stays unresolved until you explicitly choose its approved catalog result.</p>
          <ol className="variant-editor__rows draft-editor__rows">
            {draft.ingredients.map((ingredient, index) => {
              const selectionError = fieldErrors[draftIngredientFieldKey(ingredient.key, "selection")];
              const notesError = fieldErrors[draftIngredientFieldKey(ingredient.key, "preparationNotes")];
              const resolved = ingredient.selection?.kind === "request" ? ingredient.selection.request.resolved_ingredient : null;
              const catalogValue = ingredient.selection?.kind === "catalog" ? ingredient.selection.ingredient : null;
              const rowLabel = `Ingredient ${index + 1}`;
              return (
                <li key={ingredient.key} className="draft-editor__row-card">
                  <fieldset>
                    <legend>{rowLabel}</legend>
                    <div className="draft-editor__row-toolbar" aria-label={`Reorder ${rowLabel.toLowerCase()}`}>
                      <button id={`draft-${ingredient.key}-ingredient-move-up`} className="button button--quiet" type="button" disabled={index === 0} onClick={() => moveIngredient(index, -1)}>Move up<span className="visually-hidden"> {rowLabel.toLowerCase()}</span></button>
                      <button id={`draft-${ingredient.key}-ingredient-move-down`} className="button button--quiet" type="button" disabled={index === draft.ingredients.length - 1} onClick={() => moveIngredient(index, 1)}>Move down<span className="visually-hidden"> {rowLabel.toLowerCase()}</span></button>
                      <button className="button button--quiet" type="button" onClick={() => removeIngredient(index)}>Remove<span className="visually-hidden"> {rowLabel.toLowerCase()}</span></button>
                    </div>
                    {ingredient.selection?.kind === "request" ? (
                      <aside className="draft-request-selection" aria-label={`Unresolved selection for ${rowLabel}`}>
                        <span>{requestStatusLabel(ingredient.selection.request.status)}</span>
                        <strong>{ingredient.selection.request.proposed_name}</strong>
                        <p>{resolved ? `Curators resolved this request to ${resolved.canonical_name}. Choose it to make this a trusted ingredient.` : "This request text is not a trusted catalog ingredient and cannot be used as a structured action input."}</p>
                        <div className="button-row">
                          {resolved ? <button className="button button--secondary" type="button" onClick={() => replaceIngredient(ingredient.key, { ...ingredient, selection: { kind: "catalog", ingredient: { ingredientId: resolved.id, canonicalName: resolved.canonical_name, displayName: resolved.canonical_name } } })}>Use {resolved.canonical_name}</button> : null}
                          <button className="button button--quiet" type="button" onClick={() => replaceIngredient(ingredient.key, { ...ingredient, selection: null })}>Choose a different ingredient</button>
                        </div>
                      </aside>
                    ) : null}
                    <IngredientCatalogPicker
                      idPrefix={`draft-${ingredient.key}-ingredient`}
                      label="Catalog ingredient"
                      contextLabel={rowLabel}
                      value={catalogValue}
                      invalid={Boolean(selectionError)}
                      describedBy={selectionError ? `draft-${ingredient.key}-selection-error` : undefined}
                      onChange={(selection: CatalogIngredientSelection | null) => replaceIngredient(ingredient.key, { ...ingredient, selection: selection ? { kind: "catalog", ingredient: selection } : null })}
                      onRequestSubmitted={(request) => replaceIngredient(ingredient.key, { ...ingredient, selection: requestSelectionFromSubmission(request) })}
                    />
                    <FieldError id={`draft-${ingredient.key}-selection-error`} message={selectionError} />
                    <IngredientAmountControl idPrefix={`draft-${ingredient.key}-measure`} label="Amount" contextLabel={rowLabel} value={ingredient.measure} units={measurementUnits} errors={ingredientMeasureErrors(fieldErrors, ingredient.key)} onChange={(measure) => replaceIngredient(ingredient.key, { ...ingredient, measure })} />
                    <div className="variant-field">
                      <label htmlFor={`draft-${ingredient.key}-notes`}>Preparation notes <span>(optional)</span></label>
                      <input id={`draft-${ingredient.key}-notes`} value={ingredient.preparationNotes} maxLength={1000} aria-invalid={Boolean(notesError)} aria-describedby={notesError ? `draft-${ingredient.key}-notes-error` : undefined} placeholder="finely chopped" onChange={(event) => replaceIngredient(ingredient.key, { ...ingredient, preparationNotes: event.target.value })} />
                      <FieldError id={`draft-${ingredient.key}-notes-error`} message={notesError} />
                    </div>
                  </fieldset>
                </li>
              );
            })}
          </ol>
          <button id="draft-add-ingredient" className="button button--secondary" type="button" disabled={draft.ingredients.length >= 200} onClick={addIngredient}>Add ingredient</button>
        </fieldset>

        <fieldset className="variant-editor__section" disabled={editorDisabled}>
          <legend>Instructions</legend>
          <p className="variant-editor__help">Keep the readable direction, then optionally describe its trusted cooking actions in order.</p>
          <ol className="variant-editor__rows draft-editor__rows">
            {draft.instructions.map((instruction, index) => {
              const textError = fieldErrors[draftInstructionFieldKey(instruction.key)];
              const rowLabel = `Step ${index + 1}`;
              return (
                <li key={instruction.key} className="draft-editor__row-card">
                  <fieldset>
                    <legend>{rowLabel}</legend>
                    <div className="draft-editor__row-toolbar" aria-label={`Reorder ${rowLabel.toLowerCase()}`}>
                      <button id={`draft-${instruction.key}-instruction-move-up`} className="button button--quiet" type="button" disabled={index === 0} onClick={() => moveInstruction(index, -1)}>Move up<span className="visually-hidden"> {rowLabel.toLowerCase()}</span></button>
                      <button id={`draft-${instruction.key}-instruction-move-down`} className="button button--quiet" type="button" disabled={index === draft.instructions.length - 1} onClick={() => moveInstruction(index, 1)}>Move down<span className="visually-hidden"> {rowLabel.toLowerCase()}</span></button>
                      <button className="button button--quiet" type="button" onClick={() => removeInstruction(index)}>Remove<span className="visually-hidden"> {rowLabel.toLowerCase()}</span></button>
                    </div>
                    <div className="variant-field">
                      <label htmlFor={`draft-${instruction.key}-instruction-text`}>Human-readable direction</label>
                      <textarea id={`draft-${instruction.key}-instruction-text`} value={instruction.text} maxLength={5000} rows={4} aria-invalid={Boolean(textError)} aria-describedby={textError ? `draft-${instruction.key}-instruction-text-error` : undefined} onChange={(event) => replaceInstruction(instruction.key, { ...instruction, text: event.target.value })} />
                      <FieldError id={`draft-${instruction.key}-instruction-text-error`} message={textError} />
                    </div>
                    <StructuredActionEditor idPrefix={`draft-${instruction.key}-actions`} stepLabel={rowLabel} value={instruction.actions} actionTypes={actionTypes} ingredientOccurrences={ingredientOptions} measurementUnits={measurementUnits} errors={instructionActionErrors(fieldErrors, instruction.key)} onChange={(actions) => replaceInstruction(instruction.key, { ...instruction, actions })} />
                  </fieldset>
                </li>
              );
            })}
          </ol>
          <button id="draft-add-instruction" className="button button--secondary" type="button" disabled={draft.instructions.length >= 100} onClick={addInstruction}>Add instruction</button>
        </fieldset>

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

        <div className="variant-editor__actions draft-editor__actions">
          <div>
            <button className="button button--primary" type="submit" disabled={actionDisabled || !dirty}>{pending === "save" ? "Saving…" : dirty ? "Save draft" : "Draft saved"}</button>
            <GuardedLink className="button button--secondary" href="/account/recipe-drafts">Back to drafts</GuardedLink>
          </div>
          <p role="status" aria-live="polite">{status || (dirty ? "You have unsaved changes." : "All changes are saved privately.")}</p>
        </div>

        <section className="draft-editor__danger" aria-labelledby="discard-draft-title">
          <h2 id="discard-draft-title">Discard this draft</h2>
          <p>{DISCARD_COPY}</p>
          {!confirmDiscard ? <button className="button button--quiet" type="button" disabled={actionDisabled} onClick={() => setConfirmDiscard(true)}>Discard draft…</button> : (
            <div className="draft-discard">
              <p><strong>Are you sure?</strong></p>
              <div className="button-row">
                <button className="button button--danger" type="button" disabled={actionDisabled} onClick={() => void discard()}>{pending === "discard" ? "Discarding…" : "Discard permanently"}</button>
                <button className="button button--secondary" type="button" disabled={actionDisabled} onClick={() => setConfirmDiscard(false)}>Keep draft</button>
              </div>
            </div>
          )}
        </section>
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
