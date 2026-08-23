"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { createIdempotencyKey } from "../../lib/idempotency-key";
import { formatIngredientAmount } from "../../lib/format";
import type { RecipeDetail } from "../../lib/recipe-api";
import { isRecipeVersionId } from "../../lib/recipe-api";
import {
  createAddedIngredientDraft,
  createAddedInstructionDraft,
  createVariantDraft,
  ingredientFieldKey,
  instructionFieldKey,
  type RecipeVariantDraft,
  type VariantIngredientDraft,
  type VariantInstructionDraft,
  validateVariantDraft,
} from "../../lib/variant-draft";
import { createRecipeVariant, VariantApiError } from "../../lib/variant-api";

interface RecipeVariantEditorProps {
  sourceRecipe: RecipeDetail;
}

interface ForkAttempt {
  fingerprint: string;
  idempotencyKey: string;
}

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

function fieldDescription(helperId: string, errorId: string, error?: string): string {
  return error ? `${helperId} ${errorId}` : helperId;
}

function optionalValue(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function ingredientStatus(ingredient: VariantIngredientDraft): "New" | "Changed" | "Starting ingredient" {
  if (ingredient.sourceId === null) {
    return "New";
  }
  if (
    optionalValue(ingredient.ingredientName) !== null ||
    optionalValue(ingredient.quantity) !== ingredient.originalQuantity ||
    optionalValue(ingredient.unit) !== ingredient.originalUnit
  ) {
    return "Changed";
  }
  return "Starting ingredient";
}

function instructionStatus(instruction: VariantInstructionDraft): "New" | "Changed" | "Starting step" {
  if (instruction.sourceId === null) {
    return "New";
  }
  return instruction.text.trim() === instruction.originalText?.trim()
    ? "Starting step"
    : "Changed";
}

function ingredientSummary(ingredient: VariantIngredientDraft): string {
  const name = optionalValue(ingredient.ingredientName) ?? ingredient.sourceDisplayName ?? "New ingredient";
  const amount = formatIngredientAmount(
    optionalValue(ingredient.quantity),
    optionalValue(ingredient.unit),
  );
  return `${name} · ${amount}`;
}

function startingIngredientSummary(ingredient: VariantIngredientDraft): string {
  const name =
    ingredient.sourceDisplayName ?? ingredient.sourceCanonicalName ?? "Starting ingredient";
  const amount = formatIngredientAmount(ingredient.originalQuantity, ingredient.originalUnit);
  return `${name} · ${amount}`;
}

export function RecipeVariantEditor({ sourceRecipe }: RecipeVariantEditorProps) {
  const router = useRouter();
  const formId = useId().replace(/:/g, "");
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const ingredientCounter = useRef(0);
  const instructionCounter = useRef(0);
  const pendingFocusId = useRef<string | null>(null);
  const submittingRef = useRef(false);
  const forkAttemptRef = useRef<ForkAttempt | null>(null);
  const [initialDraftFingerprint] = useState(() =>
    JSON.stringify(createVariantDraft(sourceRecipe)),
  );
  const [draft, setDraft] = useState<RecipeVariantDraft>(() =>
    createVariantDraft(sourceRecipe),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [apiError, setApiError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [expandedIngredientKeys, setExpandedIngredientKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedInstructionKeys, setExpandedInstructionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const hasUnsavedChanges = JSON.stringify(draft) !== initialDraftFingerprint;

  useEffect(() => {
    if (!pendingFocusId.current) {
      return;
    }

    document.getElementById(pendingFocusId.current)?.focus();
    pendingFocusId.current = null;
  }, [draft]);

  useEffect(() => {
    if (!hasUnsavedChanges || pending) {
      return;
    }

    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges, pending]);

  function focusErrorSummary() {
    window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
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

  function focusAfterDraftUpdate(elementId: string) {
    pendingFocusId.current = elementId;
  }

  function updateMetadata(field: "title" | "description" | "servings", value: string) {
    clearErrors(field);
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateIngredient(
    key: string,
    changes: Partial<VariantIngredientDraft>,
    changedField?: "name" | "quantity" | "unit" | "preparationNotes",
  ) {
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
  ) {
    clearErrors(instructionFieldKey(key));
    setDraft((current) => ({
      ...current,
      instructions: current.instructions.map((instruction) =>
        instruction.key === key ? { ...instruction, ...changes } : instruction,
      ),
    }));
  }

  function addIngredient() {
    ingredientCounter.current += 1;
    const key = `added-ingredient-${ingredientCounter.current}`;
    const ingredient = createAddedIngredientDraft(
      key,
    );
    clearErrors();
    setExpandedIngredientKeys((current) => new Set(current).add(key));
    focusAfterDraftUpdate(`${formId}-${key}-name`);
    setDraft((current) => ({
      ...current,
      ingredients: [...current.ingredients, ingredient],
    }));
  }

  function addInstruction() {
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    const validation = validateVariantDraft(draft);
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

    submittingRef.current = true;
    setPending(true);
    setFieldErrors({});
    setFormErrors([]);
    setApiError("");
    setStatusMessage("Creating your version…");

    const fingerprint = JSON.stringify(validation.payload);
    if (forkAttemptRef.current?.fingerprint !== fingerprint) {
      forkAttemptRef.current = {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    try {
      const created = await createRecipeVariant(
        sourceRecipe.id,
        validation.payload,
        forkAttemptRef.current.idempotencyKey,
      );
      if (!isRecipeVersionId(created.id)) {
        throw new VariantApiError(
          "The recipe service returned an invalid recipe identifier.",
          502,
        );
      }
      setStatusMessage("Your version is ready. Opening the recipe…");
      router.replace(`/recipes/${encodeURIComponent(created.id)}`);
    } catch (error) {
      submittingRef.current = false;
      setPending(false);
      setStatusMessage("");
      setApiError(
        error instanceof VariantApiError
          ? error.message
          : "The recipe service could not create your version. Please try again.",
      );
      focusErrorSummary();
    }
  }

  const validationMessages = [
    ...formErrors,
    ...Array.from(new Set(Object.values(fieldErrors))),
  ];
  const hasErrors = Boolean(apiError || validationMessages.length > 0);

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
          Keep what works, or change an ingredient, amount, or unit. Use an exact catalog name
          when swapping an ingredient. Blank amounts and units mean unspecified.
        </p>
        <div className="variant-editor__rows">
          {draft.ingredients.map((ingredient, index) => {
            const rowLabel = ingredient.sourceDisplayName ?? `New ingredient ${index + 1}`;
            const nameKey = ingredientFieldKey(ingredient.key, "name");
            const quantityKey = ingredientFieldKey(ingredient.key, "quantity");
            const unitKey = ingredientFieldKey(ingredient.key, "unit");
            const notesKey = ingredientFieldKey(ingredient.key, "preparationNotes");
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
                        {optionalValue(ingredient.ingredientName) === null &&
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
                        <label htmlFor={`${rowId}-name`}>
                          {ingredient.sourceId
                            ? "Swap ingredient (optional)"
                            : "Ingredient name"}
                        </label>
                        <input
                          id={`${rowId}-name`}
                          value={ingredient.ingredientName}
                          maxLength={200}
                          aria-invalid={Boolean(fieldErrors[nameKey])}
                          aria-describedby={fieldDescription(
                            `${rowId}-name-help`,
                            `${rowId}-name-error`,
                            fieldErrors[nameKey],
                          )}
                          onChange={(event) =>
                            updateIngredient(
                              ingredient.key,
                              { ingredientName: event.target.value },
                              "name",
                            )
                          }
                        />
                        <small id={`${rowId}-name-help`}>
                          {ingredient.sourceId
                            ? "Leave blank to keep the starting ingredient."
                            : "Use an exact catalog name or alias."}
                        </small>
                        <FieldError id={`${rowId}-name-error`} message={fieldErrors[nameKey]} />
                      </div>
                      <div className="variant-field">
                        <label htmlFor={`${rowId}-quantity`}>Quantity</label>
                        <input
                          id={`${rowId}-quantity`}
                          value={ingredient.quantity}
                          inputMode="decimal"
                          aria-invalid={Boolean(fieldErrors[quantityKey])}
                          aria-describedby={`${formId}-ingredients-help${
                            fieldErrors[quantityKey] ? ` ${rowId}-quantity-error` : ""
                          }`}
                          onChange={(event) =>
                            updateIngredient(
                              ingredient.key,
                              { quantity: event.target.value },
                              "quantity",
                            )
                          }
                        />
                        <FieldError
                          id={`${rowId}-quantity-error`}
                          message={fieldErrors[quantityKey]}
                        />
                      </div>
                      <div className="variant-field">
                        <label htmlFor={`${rowId}-unit`}>Unit</label>
                        <input
                          id={`${rowId}-unit`}
                          value={ingredient.unit}
                          maxLength={64}
                          aria-invalid={Boolean(fieldErrors[unitKey])}
                          aria-describedby={`${formId}-ingredients-help${
                            fieldErrors[unitKey] ? ` ${rowId}-unit-error` : ""
                          }`}
                          onChange={(event) =>
                            updateIngredient(
                              ingredient.key,
                              { unit: event.target.value },
                              "unit",
                            )
                          }
                        />
                        <FieldError id={`${rowId}-unit-error`} message={fieldErrors[unitKey]} />
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
            const status = instructionStatus(instruction);
            const isExpanded = expandedInstructionKeys.has(instruction.key);
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
                          <p className="variant-instruction__summary">{instruction.text}</p>
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
                          updateInstruction(instruction.key, { text: event.target.value })
                        }
                      />
                      <FieldError
                        id={`${rowId}-text-error`}
                        message={fieldErrors[errorKey]}
                      />
                    </div>
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

      <footer className="variant-editor__actions">
        <div>
          <button className="button button--primary" type="submit" disabled={pending}>
            {pending ? "Creating your version…" : "Create my version"}
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
