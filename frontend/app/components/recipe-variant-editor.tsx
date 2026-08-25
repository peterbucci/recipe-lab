"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { createIdempotencyKey } from "../../lib/idempotency-key";
import { formatIngredientMeasure } from "../../lib/format";
import type { CatalogActionType } from "../../lib/cooking-action-api";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import type { RecipeDetail } from "../../lib/recipe-api";
import { isRecipeVersionId } from "../../lib/recipe-api";
import {
  createRecipeDuplicatePreflight,
  RecipeDuplicateApiError,
  recordRecipeDuplicateDecision,
  type RecipeDuplicateDecision,
  type RecipeDuplicatePreflight,
} from "../../lib/recipe-duplicate-api";
import {
  effectiveStructuredActionState,
  structuredActionFieldKey,
  structuredActionDraftsMatchRecipe,
} from "../../lib/structured-action";
import {
  formatStructuredMeasureDraft,
  structuredMeasureDraftMatchesRecipe,
  type StructuredMeasureField,
} from "../../lib/structured-measure";
import {
  createAddedIngredientDraft,
  createAddedInstructionDraft,
  createVariantDraft,
  ingredientFieldKey,
  ingredientOccurrenceOptions,
  ingredientMeasureFieldKey,
  instructionActionsFieldKey,
  instructionFieldKey,
  type RecipeVariantDraft,
  type VariantIngredientDraft,
  type VariantInstructionDraft,
  validateVariantDraft,
} from "../../lib/variant-draft";
import {
  createRecipeVariant,
  type RecipeVariantCreateRequest,
  VariantApiError,
} from "../../lib/variant-api";
import { IngredientCatalogPicker } from "./ingredient-catalog-picker";
import {
  RecipeDuplicatePreflightReview,
  RecipeDuplicateUnavailable,
} from "./recipe-duplicate-preflight-review";
import { StructuredActionEditor } from "./structured-action-editor";
import { IngredientAmountControl } from "./structured-measure-control";

interface RecipeVariantEditorProps {
  sourceRecipe: RecipeDetail;
  measurementUnits: readonly CatalogUnit[];
  actionTypes: readonly CatalogActionType[];
}

interface ForkAttempt {
  fingerprint: string;
  idempotencyKey: string;
}

interface DuplicateReviewState {
  draftRevision: number;
  payloadFingerprint: string;
  payload: RecipeVariantCreateRequest;
  result: RecipeDuplicatePreflight;
}

interface DuplicateUnavailableState {
  draftRevision: number;
  payloadFingerprint: string;
  payload: RecipeVariantCreateRequest;
}

type PendingOperation =
  | "preflight"
  | "decision-continue"
  | "decision-revise"
  | "create"
  | null;

interface FieldErrorProps {
  id: string;
  message?: string;
}

function FieldError({ id, message }: FieldErrorProps) {
  return message ? (
    <p id={id} className="variant-field-error">
      {message}
    </p>
  ) : null;
}

function ingredientStatus(ingredient: VariantIngredientDraft): "New" | "Changed" | "Starting ingredient" {
  if (ingredient.sourceId === null) {
    return "New";
  }
  if (
    ingredient.selectedIngredient !== null ||
    (ingredient.originalMeasure !== null &&
      !structuredMeasureDraftMatchesRecipe(ingredient.measure, ingredient.originalMeasure))
  ) {
    return "Changed";
  }
  return "Starting ingredient";
}

function instructionStatus(
  instruction: VariantInstructionDraft,
  ingredientKeyByOccurrenceId: ReadonlyMap<string, string>,
): "New" | "Changed" | "Starting step" {
  if (instruction.sourceId === null) {
    return "New";
  }
  return instruction.text.trim() === instruction.originalText?.trim() &&
    structuredActionDraftsMatchRecipe(
      instruction.actions,
      instruction.originalActions,
      ingredientKeyByOccurrenceId,
    )
    ? "Starting step"
    : "Changed";
}

function ingredientSummary(ingredient: VariantIngredientDraft): string {
  const name =
    ingredient.selectedIngredient?.displayName ??
    ingredient.sourceDisplayName ??
    "New ingredient";
  const amount = formatStructuredMeasureDraft(ingredient.measure);
  return `${name} · ${amount}`;
}

function startingIngredientSummary(ingredient: VariantIngredientDraft): string {
  const name =
    ingredient.sourceDisplayName ?? ingredient.sourceCanonicalName ?? "Starting ingredient";
  const amount = ingredient.originalMeasure
    ? formatIngredientMeasure(ingredient.originalMeasure)
    : "Amount not specified";
  return `${name} · ${amount}`;
}

function effectiveMeasureState(
  measure: VariantIngredientDraft["measure"],
  originalMeasure: VariantIngredientDraft["originalMeasure"],
) {
  if (
    originalMeasure !== null &&
    structuredMeasureDraftMatchesRecipe(measure, originalMeasure)
  ) {
    return { matchesOriginal: true };
  }
  if (measure.mode === "exact") {
    return {
      mode: measure.mode,
      exactValue: measure.exactValue,
      unitId: measure.unit?.id ?? null,
      packageSizeId: measure.packageSizeId,
    };
  }
  if (measure.mode === "range") {
    return {
      mode: measure.mode,
      rangeMinimum: measure.rangeMinimum,
      rangeMaximum: measure.rangeMaximum,
      unitId: measure.unit?.id ?? null,
      packageSizeId: measure.packageSizeId,
    };
  }
  return { mode: measure.mode };
}

function draftFingerprint(draft: RecipeVariantDraft): string {
  const ingredientKeyByOccurrenceId = new Map(
    draft.ingredients.flatMap((ingredient) =>
      ingredient.sourceId ? [[ingredient.sourceId, ingredient.key] as const] : [],
    ),
  );
  return JSON.stringify({
    ...draft,
    ingredients: draft.ingredients.map((ingredient) => ({
      ...ingredient,
      measure: effectiveMeasureState(ingredient.measure, ingredient.originalMeasure),
    })),
    instructions: draft.instructions.map((instruction) => ({
      ...instruction,
      actions: effectiveStructuredActionState(
        instruction.actions,
        instruction.originalActions,
        ingredientKeyByOccurrenceId,
      ),
    })),
  });
}

function packageSizeForEffectiveIdentity(
  ingredient: VariantIngredientDraft,
  selectedIngredient: VariantIngredientDraft["selectedIngredient"],
  measure: VariantIngredientDraft["measure"],
): string | null {
  const originalMeasure = ingredient.originalMeasure;
  if (originalMeasure === null || originalMeasure.kind === "qualitative") {
    return null;
  }
  const effectiveIngredientId =
    selectedIngredient?.ingredientId ?? ingredient.sourceIngredientId;
  if (
    effectiveIngredientId !== ingredient.sourceIngredientId ||
    measure.unit?.id !== originalMeasure.unit.id
  ) {
    return null;
  }
  return originalMeasure.package_size_id ?? null;
}

export function RecipeVariantEditor({
  sourceRecipe,
  measurementUnits,
  actionTypes,
}: RecipeVariantEditorProps) {
  const router = useRouter();
  const formId = useId().replace(/:/g, "");
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const errorSummaryFocusRequestedRef = useRef(false);
  const ingredientCounter = useRef(0);
  const instructionCounter = useRef(0);
  const pendingFocusId = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const successfulCreationRef = useRef(false);
  const draftRevisionRef = useRef(0);
  const preflightAttemptRef = useRef<ForkAttempt | null>(null);
  const decisionAttemptRef = useRef<ForkAttempt | null>(null);
  const forkAttemptRef = useRef<ForkAttempt | null>(null);
  const [initialDraftFingerprint] = useState(() =>
    draftFingerprint(createVariantDraft(sourceRecipe)),
  );
  const [draft, setDraft] = useState<RecipeVariantDraft>(() =>
    createVariantDraft(sourceRecipe),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [apiError, setApiError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<PendingOperation>(null);
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReviewState | null>(
    null,
  );
  const [duplicateUnavailable, setDuplicateUnavailable] =
    useState<DuplicateUnavailableState | null>(null);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [duplicateDecisionFailure, setDuplicateDecisionFailure] =
    useState<RecipeDuplicateDecision | null>(null);
  const [expandedIngredientKeys, setExpandedIngredientKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedInstructionKeys, setExpandedInstructionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const currentDraftFingerprint = draftFingerprint(draft);
  const activeDuplicateReview = duplicateReview;
  const hasUnsavedChanges = currentDraftFingerprint !== initialDraftFingerprint;

  useEffect(() => {
    if (!pendingFocusId.current) {
      return;
    }

    document.getElementById(pendingFocusId.current)?.focus();
    pendingFocusId.current = null;
  }, [draft]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (successfulCreationRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  function focusErrorSummary() {
    errorSummaryFocusRequestedRef.current = true;
  }

  function clearErrors(fieldKey?: string) {
    setApiError("");
    setFormErrors([]);
    if (fieldKey) {
      setFieldErrors((current) => {
        if (!(fieldKey in current)) {
          return current;
        }
        const next = { ...current };
        delete next[fieldKey];
        return next;
      });
    }
  }

  function clearRowErrors(fieldPrefix: string) {
    setApiError("");
    setFormErrors([]);
    setFieldErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith(fieldPrefix)),
      ),
    );
  }

  function clearActionInputErrorsForIngredient(ingredientKey: string) {
    const affectedFields = new Set(
      draft.instructions.flatMap((instruction) =>
        instruction.actions.flatMap((action) =>
          action.ingredientKeys.includes(ingredientKey)
            ? [
                `instruction.${instruction.key}.action.${structuredActionFieldKey(
                  action.key,
                  "inputs",
                )}`,
              ]
            : [],
        ),
      ),
    );
    if (affectedFields.size === 0) {
      return;
    }
    setFieldErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([fieldKey]) => !affectedFields.has(fieldKey)),
      ),
    );
  }

  function focusAfterDraftUpdate(elementId: string) {
    pendingFocusId.current = elementId;
  }

  function markDraftEdited() {
    draftRevisionRef.current += 1;
    if (duplicateReview !== null || duplicateUnavailable !== null) {
      setDuplicateReview(null);
      setDuplicateUnavailable(null);
      setDuplicateAcknowledged(false);
      setDuplicateDecisionFailure(null);
      decisionAttemptRef.current = null;
      setStatusMessage("Your draft changed. Check its recipe structure again when ready.");
    }
  }

  function updateMetadata(field: "title" | "description" | "servings", value: string) {
    markDraftEdited();
    clearErrors(field);
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateIngredient(
    key: string,
    changes: Partial<VariantIngredientDraft>,
    changedField?: "name" | "preparationNotes",
  ) {
    markDraftEdited();
    clearErrors(changedField ? ingredientFieldKey(key, changedField) : undefined);
    setDraft((current) => ({
      ...current,
      ingredients: current.ingredients.map((ingredient) =>
        ingredient.key === key ? { ...ingredient, ...changes } : ingredient,
      ),
    }));
  }

  function updateInstruction(
    key: string,
    changes: Partial<VariantInstructionDraft>,
    changedField: "text" | "actions" = "text",
  ) {
    markDraftEdited();
    if (changedField === "actions") {
      setApiError("");
      setFormErrors([]);
      setFieldErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([fieldKey]) =>
              fieldKey !== instructionActionsFieldKey(key) &&
              !fieldKey.startsWith(`instruction.${key}.action.`),
          ),
        ),
      );
    } else {
      clearErrors(instructionFieldKey(key));
    }
    setDraft((current) => ({
      ...current,
      instructions: current.instructions.map((instruction) =>
        instruction.key === key ? { ...instruction, ...changes } : instruction,
      ),
    }));
  }

  function addIngredient() {
    markDraftEdited();
    ingredientCounter.current += 1;
    const key = `added-ingredient-${ingredientCounter.current}`;
    const ingredient = createAddedIngredientDraft(
      key,
    );
    clearErrors();
    setExpandedIngredientKeys((current) => new Set(current).add(key));
    focusAfterDraftUpdate(`${formId}-${key}-ingredient-search`);
    setDraft((current) => ({
      ...current,
      ingredients: [...current.ingredients, ingredient],
    }));
  }

  function addInstruction() {
    markDraftEdited();
    instructionCounter.current += 1;
    const key = `added-instruction-${instructionCounter.current}`;
    const instruction = createAddedInstructionDraft(
      key,
    );
    clearErrors();
    setExpandedInstructionKeys((current) => new Set(current).add(key));
    focusAfterDraftUpdate(`${formId}-${key}-text`);
    setDraft((current) => ({
      ...current,
      instructions: [...current.instructions, instruction],
    }));
  }

  function finishWithError(error: unknown, kind: "duplicate" | "variant") {
    submittingRef.current = false;
    setPending(false);
    setPendingOperation(null);
    setStatusMessage("");
    setDuplicateReview(null);
    setDuplicateUnavailable(null);
    setDuplicateAcknowledged(false);
    setDuplicateDecisionFailure(null);
    setApiError(
      kind === "duplicate"
        ? error instanceof RecipeDuplicateApiError
          ? error.message
          : "Recipe Lab could not check this version right now. Your draft is still here; please try again."
        : error instanceof VariantApiError
          ? error.message
          : "The recipe service could not create your version. Please try again.",
    );
    focusErrorSummary();
  }

  function advisoryFailureCanBeSkipped(error: unknown): boolean {
    if (error instanceof TypeError) {
      return true;
    }
    return error instanceof RecipeDuplicateApiError && error.status >= 500;
  }

  function resetDuplicateAttemptsAfterConflict(error: unknown) {
    if (
      error instanceof RecipeDuplicateApiError &&
      error.status === 409 &&
      (error.code === "duplicate_preflight_stale" ||
        error.code === "idempotency_key_conflict")
    ) {
      preflightAttemptRef.current = null;
      decisionAttemptRef.current = null;
    }
  }

  function finishUnavailablePreflight(
    error: unknown,
    unavailable: DuplicateUnavailableState,
  ) {
    if (!advisoryFailureCanBeSkipped(error)) {
      resetDuplicateAttemptsAfterConflict(error);
      finishWithError(error, "duplicate");
      return;
    }
    submittingRef.current = false;
    setPending(false);
    setPendingOperation(null);
    setDuplicateReview(null);
    setDuplicateAcknowledged(false);
    setDuplicateDecisionFailure(null);
    setDuplicateUnavailable(unavailable);
    setApiError("");
    setStatusMessage(
      "The advisory similarity review could not be completed. Your draft is still here.",
    );
  }

  function finishUnavailableDecision(
    error: unknown,
    decision: RecipeDuplicateDecision,
  ) {
    if (!advisoryFailureCanBeSkipped(error)) {
      resetDuplicateAttemptsAfterConflict(error);
      finishWithError(error, "duplicate");
      return;
    }
    submittingRef.current = false;
    setPending(false);
    setPendingOperation(null);
    setDuplicateDecisionFailure(decision);
    setApiError("");
    setStatusMessage(
      "Recipe Lab could not confirm whether your advisory review choice was recorded.",
    );
  }

  async function createValidatedVariant(
    payload: RecipeVariantCreateRequest,
    fingerprint: string,
  ) {
    setPendingOperation("create");
    setStatusMessage("Creating your version…");
    if (forkAttemptRef.current?.fingerprint !== fingerprint) {
      forkAttemptRef.current = {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    try {
      const created = await createRecipeVariant(
        sourceRecipe.id,
        payload,
        forkAttemptRef.current.idempotencyKey,
      );
      if (!isRecipeVersionId(created.id)) {
        throw new VariantApiError(
          "The recipe service returned an invalid recipe identifier.",
          502,
        );
      }
      setStatusMessage("Your version is ready. Opening the recipe…");
      successfulCreationRef.current = true;
      router.replace(`/recipes/${encodeURIComponent(created.id)}`);
    } catch (error) {
      finishWithError(error, "variant");
    }
  }

  async function recordDuplicateDecision(decision: RecipeDuplicateDecision) {
    const review = activeDuplicateReview;
    if (
      review === null ||
      submittingRef.current ||
      (decision === "continue" && !duplicateAcknowledged)
    ) {
      return;
    }

    submittingRef.current = true;
    setPending(true);
    setPendingOperation(decision === "continue" ? "decision-continue" : "decision-revise");
    setFieldErrors({});
    setFormErrors([]);
    setApiError("");
    setDuplicateDecisionFailure(null);
    setStatusMessage(
      decision === "continue"
        ? "Recording your choice before creating the version…"
        : "Recording your choice and returning to the draft…",
    );

    const acknowledgement = review.result.acknowledgement;
    const decisionFingerprint = [
      acknowledgement.preflight_id,
      acknowledgement.policy_version,
      acknowledgement.result_digest,
      decision,
    ].join(":");
    if (decisionAttemptRef.current?.fingerprint !== decisionFingerprint) {
      decisionAttemptRef.current = {
        fingerprint: decisionFingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    try {
      await recordRecipeDuplicateDecision(
        acknowledgement.preflight_id,
        {
          policy_version: acknowledgement.policy_version,
          result_digest: acknowledgement.result_digest,
          decision,
        },
        decisionAttemptRef.current.idempotencyKey,
      );

      if (draftRevisionRef.current !== review.draftRevision) {
        submittingRef.current = false;
        setPending(false);
        setPendingOperation(null);
        setDuplicateReview(null);
        setDuplicateAcknowledged(false);
        setStatusMessage("Your draft changed. Check its recipe structure again when ready.");
        return;
      }

      setDuplicateReview(null);
      setDuplicateAcknowledged(false);
      setDuplicateDecisionFailure(null);
      if (decision === "continue") {
        await createValidatedVariant(review.payload, review.payloadFingerprint);
        return;
      }

      submittingRef.current = false;
      setPending(false);
      setPendingOperation(null);
      preflightAttemptRef.current = null;
      decisionAttemptRef.current = null;
      setStatusMessage("Your choice was recorded. Every draft field is ready to revise.");
      window.setTimeout(() => document.getElementById(`${formId}-title`)?.focus(), 0);
    } catch (error) {
      finishUnavailableDecision(error, decision);
    }
  }

  async function retryUnavailableDecision() {
    if (duplicateDecisionFailure === null) {
      return;
    }
    await recordDuplicateDecision(duplicateDecisionFailure);
  }

  async function createWithoutRecordedDecision() {
    const review = activeDuplicateReview;
    if (
      review === null ||
      duplicateDecisionFailure !== "continue" ||
      submittingRef.current
    ) {
      return;
    }
    submittingRef.current = true;
    setPending(true);
    setDuplicateReview(null);
    setDuplicateAcknowledged(false);
    setDuplicateDecisionFailure(null);
    preflightAttemptRef.current = null;
    decisionAttemptRef.current = null;
    await createValidatedVariant(review.payload, review.payloadFingerprint);
  }

  function returnWithoutRecordedDecision() {
    if (duplicateDecisionFailure !== "revise" || submittingRef.current) {
      return;
    }
    setDuplicateReview(null);
    setDuplicateAcknowledged(false);
    setDuplicateDecisionFailure(null);
    preflightAttemptRef.current = null;
    decisionAttemptRef.current = null;
    setStatusMessage(
      "The review decision was not confirmed. Every draft field is ready to revise.",
    );
    window.setTimeout(() => document.getElementById(`${formId}-title`)?.focus(), 0);
  }

  async function runDuplicatePreflight(
    unavailable: DuplicateUnavailableState,
    preserveFallback: boolean,
  ) {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setPending(true);
    setPendingOperation("preflight");
    setFieldErrors({});
    setFormErrors([]);
    setApiError("");
    setDuplicateReview(null);
    setDuplicateAcknowledged(false);
    setDuplicateDecisionFailure(null);
    if (!preserveFallback) {
      setDuplicateUnavailable(null);
    }
    setStatusMessage("Checking this version's recipe structure…");

    if (preflightAttemptRef.current?.fingerprint !== unavailable.payloadFingerprint) {
      preflightAttemptRef.current = {
        fingerprint: unavailable.payloadFingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    try {
      const result = await createRecipeDuplicatePreflight(
        sourceRecipe.id,
        unavailable.payload,
        preflightAttemptRef.current.idempotencyKey,
      );
      if (draftRevisionRef.current !== unavailable.draftRevision) {
        submittingRef.current = false;
        setPending(false);
        setPendingOperation(null);
        setDuplicateUnavailable(null);
        setStatusMessage("Your draft changed. Check its recipe structure again when ready.");
        return;
      }

      setDuplicateUnavailable(null);
      if (result.classification === "distinct") {
        await createValidatedVariant(
          unavailable.payload,
          unavailable.payloadFingerprint,
        );
        return;
      }

      setDuplicateReview({ ...unavailable, result });
      submittingRef.current = false;
      setPending(false);
      setPendingOperation(null);
      setStatusMessage("Review the advisory recipe-structure results before continuing.");
    } catch (error) {
      finishUnavailablePreflight(error, unavailable);
    }
  }

  async function retryUnavailablePreflight() {
    if (duplicateUnavailable === null) {
      return;
    }
    await runDuplicatePreflight(duplicateUnavailable, true);
  }

  async function createWithoutDuplicateReview() {
    const unavailable = duplicateUnavailable;
    if (unavailable === null || submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setPending(true);
    setFieldErrors({});
    setFormErrors([]);
    setApiError("");
    await createValidatedVariant(
      unavailable.payload,
      unavailable.payloadFingerprint,
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submittingRef.current ||
      activeDuplicateReview !== null ||
      duplicateUnavailable !== null
    ) {
      return;
    }

    const validation = validateVariantDraft(draft, measurementUnits, actionTypes);
    if (validation.payload === null) {
      const invalidIngredientKeys = Object.keys(validation.fieldErrors)
        .filter((key) => key.startsWith("ingredient."))
        .map((key) => key.split(".")[1])
        .filter((key): key is string => Boolean(key));
      const invalidInstructionKeys = Object.keys(validation.fieldErrors)
        .filter((key) => key.startsWith("instruction."))
        .map((key) => key.split(".")[1])
        .filter((key): key is string => Boolean(key));
      if (invalidIngredientKeys.length > 0) {
        setExpandedIngredientKeys((current) =>
          new Set([...current, ...invalidIngredientKeys]),
        );
      }
      if (invalidInstructionKeys.length > 0) {
        setExpandedInstructionKeys((current) =>
          new Set([...current, ...invalidInstructionKeys]),
        );
      }
      setFieldErrors(validation.fieldErrors);
      setFormErrors(validation.formErrors);
      setApiError("");
      setStatusMessage("");
      focusErrorSummary();
      return;
    }

    const payloadFingerprint = JSON.stringify(validation.payload);
    await runDuplicatePreflight(
      {
        draftRevision: draftRevisionRef.current,
        payloadFingerprint,
        payload: validation.payload,
      },
      false,
    );
  }

  const validationMessages = [
    ...formErrors,
    ...Array.from(new Set(Object.values(fieldErrors))),
  ];
  const hasErrors = Boolean(apiError || validationMessages.length > 0);

  useEffect(() => {
    if (!hasErrors || !errorSummaryFocusRequestedRef.current) {
      return;
    }
    errorSummaryRef.current?.focus();
    errorSummaryFocusRequestedRef.current = false;
  }, [apiError, fieldErrors, formErrors, hasErrors]);

  return (
    <form
      className="variant-editor"
      aria-busy={pending}
      aria-label={`Make ${sourceRecipe.title} your own`}
      noValidate
      onSubmit={handleSubmit}
    >
      {hasErrors ? (
        <div
          ref={errorSummaryRef}
          className="variant-error-summary"
          role="alert"
          tabIndex={-1}
        >
          <h2>Check your version before creating it</h2>
          {apiError ? <p>{apiError}</p> : null}
          {validationMessages.length > 0 ? (
            <ul>
              {validationMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <fieldset className="variant-editor__section" disabled={pending}>
        <legend>About your version</legend>
        <div className="variant-details-grid">
          <div className="variant-field variant-field--wide">
            <label htmlFor={`${formId}-title`}>Title</label>
            <input
              id={`${formId}-title`}
              value={draft.title}
              maxLength={200}
              aria-invalid={Boolean(fieldErrors.title)}
              aria-describedby={fieldErrors.title ? `${formId}-title-error` : undefined}
              onChange={(event) => updateMetadata("title", event.target.value)}
            />
            <FieldError id={`${formId}-title-error`} message={fieldErrors.title} />
          </div>
          <div className="variant-field variant-field--wide">
            <label htmlFor={`${formId}-description`}>Description</label>
            <textarea
              id={`${formId}-description`}
              value={draft.description}
              rows={3}
              maxLength={2_000}
              aria-invalid={Boolean(fieldErrors.description)}
              aria-describedby={
                fieldErrors.description ? `${formId}-description-error` : undefined
              }
              onChange={(event) => updateMetadata("description", event.target.value)}
            />
            <FieldError
              id={`${formId}-description-error`}
              message={fieldErrors.description}
            />
          </div>
          <div className="variant-field">
            <label htmlFor={`${formId}-servings`}>Servings</label>
            <input
              id={`${formId}-servings`}
              value={draft.servings}
              inputMode="decimal"
              aria-invalid={Boolean(fieldErrors.servings)}
              aria-describedby={`${formId}-servings-help${
                fieldErrors.servings ? ` ${formId}-servings-error` : ""
              }`}
              onChange={(event) => updateMetadata("servings", event.target.value)}
            />
            <small id={`${formId}-servings-help`}>Use a positive number with up to two decimals.</small>
            <FieldError id={`${formId}-servings-error`} message={fieldErrors.servings} />
          </div>
        </div>
      </fieldset>

      <fieldset
        className="variant-editor__section"
        disabled={pending}
        aria-describedby={`${formId}-ingredients-help`}
      >
        <legend>Ingredients</legend>
        <p id={`${formId}-ingredients-help`} className="variant-editor__help">
          Keep what works, or change an ingredient or its structured amount. Choose every added or
          swapped ingredient and every numeric unit from the curated catalog. Exact values, ranges,
          and qualitative amounts remain distinct.
        </p>
        <div className="variant-editor__rows">
          {draft.ingredients.map((ingredient, index) => {
            const rowLabel = ingredient.sourceDisplayName ?? `New ingredient ${index + 1}`;
            const nameKey = ingredientFieldKey(ingredient.key, "name");
            const notesKey = ingredientFieldKey(ingredient.key, "preparationNotes");
            const measureErrors = Object.fromEntries(
              (["mode", "amount", "minimum", "maximum", "unit"] as const)
                .map((field) => [
                  field,
                  fieldErrors[ingredientMeasureFieldKey(ingredient.key, field)],
                ])
                .filter((entry): entry is [StructuredMeasureField, string] =>
                  Boolean(entry[1]),
                ),
            );
            const rowId = `${formId}-${ingredient.key}`;
            const groupLabel = ingredient.sourceDisplayName
              ? `Ingredient ${index + 1}: ${ingredient.sourceDisplayName}`
              : `New ingredient ${index + 1}`;
            const removeToggleId = `${rowId}-remove-toggle`;
            const status = ingredientStatus(ingredient);
            const isExpanded = expandedIngredientKeys.has(ingredient.key);

            return (
              <fieldset
                key={ingredient.key}
                className={`variant-row${ingredient.removed ? " variant-row--removed" : ""}`}
              >
                <legend>{groupLabel}</legend>
                {ingredient.removed ? (
                  <div className="variant-removed-row">
                    <p>
                      <strong>{rowLabel}</strong> will not be included in your version.
                    </p>
                    <button
                      id={removeToggleId}
                      className="button button--secondary"
                      type="button"
                      onClick={() => {
                        clearRowErrors(`ingredient.${ingredient.key}.`);
                        clearActionInputErrorsForIngredient(ingredient.key);
                        focusAfterDraftUpdate(removeToggleId);
                        updateIngredient(ingredient.key, { removed: false });
                      }}
                    >
                      Undo removal of {rowLabel}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="variant-row__source">
                      <div>
                        <span
                          className={`variant-row__status${status === "Changed" ? " variant-row__status--changed" : ""}`}
                        >
                          {status}
                        </span>
                        <strong>{ingredientSummary(ingredient)}</strong>
                        {status === "Changed" ? (
                          <small className="variant-row__change-summary">
                            Before: {startingIngredientSummary(ingredient)} → Now:{" "}
                            {ingredientSummary(ingredient)}
                          </small>
                        ) : null}
                        {ingredient.selectedIngredient?.displayName !==
                        ingredient.selectedIngredient?.canonicalName ? (
                          <small>
                            Catalog name: {ingredient.selectedIngredient?.canonicalName}
                          </small>
                        ) : ingredient.selectedIngredient === null &&
                          ingredient.sourceCanonicalName !== ingredient.sourceDisplayName ? (
                          <small>Catalog name: {ingredient.sourceCanonicalName}</small>
                        ) : null}
                        {ingredient.preparationNotes ? (
                          <small>Preparation: {ingredient.preparationNotes}</small>
                        ) : null}
                      </div>
                      <button
                        className="button button--secondary variant-row__edit"
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={`${rowId}-fields`}
                        onClick={() =>
                          setExpandedIngredientKeys((current) => {
                            const next = new Set(current);
                            if (next.has(ingredient.key)) {
                              next.delete(ingredient.key);
                            } else {
                              next.add(ingredient.key);
                            }
                            return next;
                          })
                        }
                      >
                        {isExpanded
                          ? `Done editing ${rowLabel}`
                          : `Change ${rowLabel}`}
                      </button>
                    </div>
                    {isExpanded ? (
                    <div id={`${rowId}-fields`} className="variant-row__fields">
                    <div className="variant-ingredient-grid">
                      <div className="variant-field variant-field--name">
                        <IngredientCatalogPicker
                          idPrefix={`${rowId}-ingredient`}
                          contextLabel={groupLabel}
                          label={
                            ingredient.sourceId
                              ? "Swap ingredient (optional)"
                              : "Ingredient"
                          }
                          value={ingredient.selectedIngredient}
                          disabled={pending}
                          invalid={Boolean(fieldErrors[nameKey])}
                          describedBy={fieldErrors[nameKey] ? `${rowId}-name-error` : undefined}
                          onChange={(selection) =>
                            updateIngredient(
                              ingredient.key,
                              {
                                selectedIngredient: selection,
                                measure: {
                                  ...ingredient.measure,
                                  packageSizeId: packageSizeForEffectiveIdentity(
                                    ingredient,
                                    selection,
                                    ingredient.measure,
                                  ),
                                },
                              },
                              "name",
                            )
                          }
                        />
                        <FieldError id={`${rowId}-name-error`} message={fieldErrors[nameKey]} />
                      </div>
                      <div className="variant-field variant-field--measure">
                        <IngredientAmountControl
                          idPrefix={`${rowId}-measure`}
                          label="Amount"
                          contextLabel={groupLabel}
                          value={ingredient.measure}
                          units={measurementUnits}
                          errors={measureErrors}
                          disabled={pending}
                          describedBy={`${formId}-ingredients-help`}
                          onChange={(measure) => {
                            clearRowErrors(`ingredient.${ingredient.key}.measure.`);
                            updateIngredient(ingredient.key, {
                              measure: {
                                ...measure,
                                packageSizeId: packageSizeForEffectiveIdentity(
                                  ingredient,
                                  ingredient.selectedIngredient,
                                  measure,
                                ),
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                    {ingredient.sourceId === null ? (
                      <div className="variant-field">
                        <label htmlFor={`${rowId}-notes`}>Preparation notes (optional)</label>
                        <input
                          id={`${rowId}-notes`}
                          value={ingredient.preparationNotes}
                          maxLength={1_000}
                          aria-invalid={Boolean(fieldErrors[notesKey])}
                          aria-describedby={fieldErrors[notesKey] ? `${rowId}-notes-error` : undefined}
                          onChange={(event) =>
                            updateIngredient(
                              ingredient.key,
                              { preparationNotes: event.target.value },
                              "preparationNotes",
                            )
                          }
                        />
                        <FieldError id={`${rowId}-notes-error`} message={fieldErrors[notesKey]} />
                      </div>
                    ) : null}
                    <button
                      id={removeToggleId}
                      className="button button--quiet variant-row__remove"
                      type="button"
                      onClick={() => {
                        clearRowErrors(`ingredient.${ingredient.key}.`);
                        focusAfterDraftUpdate(removeToggleId);
                        updateIngredient(ingredient.key, { removed: true });
                      }}
                    >
                      Remove {rowLabel}
                    </button>
                    </div>
                    ) : null}
                  </>
                )}
              </fieldset>
            );
          })}
        </div>
        <button className="button button--secondary" type="button" onClick={addIngredient}>
          Add ingredient
        </button>
      </fieldset>

      <fieldset className="variant-editor__section" disabled={pending}>
        <legend>Instructions</legend>
        <p className="variant-editor__help">
          Rewrite a step, leave it as written, remove it, or add a new one.
        </p>
        <ol className="variant-instruction-list">
          {draft.instructions.map((instruction, index) => {
            const errorKey = instructionFieldKey(instruction.key);
            const rowId = `${formId}-${instruction.key}`;
            const removeToggleId = `${rowId}-remove-toggle`;
            const ingredientKeyByOccurrenceId = new Map(
              draft.ingredients.flatMap((ingredient) =>
                ingredient.sourceId
                  ? [[ingredient.sourceId, ingredient.key] as const]
                  : [],
              ),
            );
            const status = instructionStatus(instruction, ingredientKeyByOccurrenceId);
            const isExpanded = expandedInstructionKeys.has(instruction.key);
            const actionErrorPrefix = `instruction.${instruction.key}.action.`;
            const actionErrors = Object.fromEntries([
              ...(fieldErrors[`instruction.${instruction.key}.actions`]
                ? [["actions", fieldErrors[`instruction.${instruction.key}.actions`]]]
                : []),
              ...Object.entries(fieldErrors)
                .filter(([key]) => key.startsWith(actionErrorPrefix))
                .map(([key, message]) => [key.slice(actionErrorPrefix.length), message]),
            ]);
            return (
              <li
                key={instruction.key}
                className={instruction.removed ? "variant-row--removed" : undefined}
              >
                {instruction.removed ? (
                  <div className="variant-removed-row">
                    <p>
                      <strong>Step {index + 1}</strong> will not be included in your version.
                    </p>
                    <button
                      id={removeToggleId}
                      className="button button--secondary"
                      type="button"
                      onClick={() => {
                        clearErrors(errorKey);
                        focusAfterDraftUpdate(removeToggleId);
                        updateInstruction(instruction.key, { removed: false });
                      }}
                    >
                      Undo removal of step {index + 1}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="variant-instruction__header">
                      <div>
                        <strong>Step {index + 1}</strong>
                        <span
                          className={`variant-row__status${status === "Changed" ? " variant-row__status--changed" : ""}`}
                        >
                          {status}
                        </span>
                        {!isExpanded ? (
                          <div className="variant-instruction__summary">
                            <p>{instruction.text}</p>
                            <small>
                              {instruction.actions.length > 0
                                ? instruction.actions
                                    .map((action) => action.actionType?.canonical_verb ?? "Action needed")
                                    .join(" → ")
                                : "No structured actions mapped"}
                            </small>
                          </div>
                        ) : null}
                      </div>
                      <button
                        className="button button--secondary variant-row__edit"
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={`${rowId}-fields`}
                        onClick={() =>
                          setExpandedInstructionKeys((current) => {
                            const next = new Set(current);
                            if (next.has(instruction.key)) {
                              next.delete(instruction.key);
                            } else {
                              next.add(instruction.key);
                            }
                            return next;
                          })
                        }
                      >
                        {isExpanded
                          ? `Done editing step ${index + 1}`
                          : `Edit step ${index + 1}`}
                      </button>
                    </div>
                    {isExpanded ? (
                    <div id={`${rowId}-fields`} className="variant-row__fields">
                    <div className="variant-field">
                      <label htmlFor={`${rowId}-text`}>Instruction</label>
                      <textarea
                        id={`${rowId}-text`}
                        value={instruction.text}
                        rows={3}
                        maxLength={5_000}
                        aria-invalid={Boolean(fieldErrors[errorKey])}
                        aria-describedby={
                          fieldErrors[errorKey] ? `${rowId}-text-error` : undefined
                        }
                        onChange={(event) =>
                          updateInstruction(
                            instruction.key,
                            { text: event.target.value },
                            "text",
                          )
                        }
                      />
                      <FieldError
                        id={`${rowId}-text-error`}
                        message={fieldErrors[errorKey]}
                      />
                    </div>
                    <StructuredActionEditor
                      idPrefix={`${rowId}-actions`}
                      stepLabel={`step ${index + 1}`}
                      value={instruction.actions}
                      actionTypes={actionTypes}
                      ingredientOccurrences={ingredientOccurrenceOptions(draft.ingredients)}
                      measurementUnits={measurementUnits}
                      errors={actionErrors}
                      disabled={pending}
                      onChange={(actions) =>
                        updateInstruction(instruction.key, { actions }, "actions")
                      }
                    />
                    <button
                      id={removeToggleId}
                      className="button button--quiet variant-row__remove"
                      type="button"
                      onClick={() => {
                        clearErrors(errorKey);
                        focusAfterDraftUpdate(removeToggleId);
                        updateInstruction(instruction.key, { removed: true });
                      }}
                    >
                      Remove step {index + 1}
                    </button>
                    </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ol>
        <button className="button button--secondary" type="button" onClick={addInstruction}>
          Add instruction
        </button>
      </fieldset>

      {activeDuplicateReview ? (
        <RecipeDuplicatePreflightReview
          result={activeDuplicateReview.result}
          acknowledged={duplicateAcknowledged}
          decisionFailure={duplicateDecisionFailure}
          pendingDecision={
            pendingOperation === "decision-continue"
              ? "continue"
              : pendingOperation === "decision-revise"
                ? "revise"
                : null
          }
          onAcknowledgedChange={setDuplicateAcknowledged}
          onContinue={() => void recordDuplicateDecision("continue")}
          onRevise={() => void recordDuplicateDecision("revise")}
          onRetryDecision={() => void retryUnavailableDecision()}
          onCreateWithoutRecordedDecision={() =>
            void createWithoutRecordedDecision()
          }
          onReturnWithoutRecordedDecision={returnWithoutRecordedDecision}
        />
      ) : null}

      {duplicateUnavailable ? (
        <RecipeDuplicateUnavailable
          pendingAction={
            pendingOperation === "preflight"
              ? "retry"
              : pendingOperation === "create"
                ? "create"
                : null
          }
          onRetry={() => void retryUnavailablePreflight()}
          onCreateWithoutReview={() => void createWithoutDuplicateReview()}
        />
      ) : null}

      <footer className="variant-editor__actions">
        <div>
          <button
            className="button button--primary"
            type="submit"
            disabled={
              pending ||
              activeDuplicateReview !== null ||
              duplicateUnavailable !== null
            }
          >
            {pendingOperation === "preflight"
              ? "Checking recipe structure…"
              : pendingOperation === "create"
                ? "Creating your version…"
                : activeDuplicateReview
                  ? "Review similarity results"
                  : duplicateUnavailable
                    ? "Choose how to continue"
                  : "Create my version"}
          </button>
          {pending ? (
            <span className="button button--disabled" aria-disabled="true">
              Cancel
            </span>
          ) : (
            <Link className="button button--secondary" href={`/recipes/${sourceRecipe.id}`}>
              Cancel
            </Link>
          )}
        </div>
        <p role="status" aria-live="polite">
          {statusMessage ||
            (hasUnsavedChanges
              ? "You have unsaved changes."
              : "Start with the recipe as written, then change only what you need.")}
        </p>
      </footer>
    </form>
  );
}
