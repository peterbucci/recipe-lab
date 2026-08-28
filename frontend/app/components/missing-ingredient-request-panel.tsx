"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  IngredientCatalogApiError,
  type MissingIngredientRequest,
  submitMissingIngredientRequest,
} from "../../lib/ingredient-catalog-api";

interface MissingIngredientRequestPanelProps {
  disabled?: boolean;
  idPrefix: string;
  initialName: string;
  onClose: () => void;
  onSubmitted?: (request: MissingIngredientRequest) => void;
}

interface RequestFieldErrors {
  context?: string;
  proposedName?: string;
}

function validateRequest(proposedName: string, context: string): RequestFieldErrors {
  const errors: RequestFieldErrors = {};
  const normalizedName = proposedName.trim();
  if (!normalizedName) {
    errors.proposedName = "Proposed ingredient name is required.";
  } else if (normalizedName.length > 200) {
    errors.proposedName = "Proposed ingredient name must be 200 characters or fewer.";
  }
  if (context.trim().length > 500) {
    errors.context = "Context must be 500 characters or fewer.";
  }
  return errors;
}

export function MissingIngredientRequestPanel({
  disabled = false,
  idPrefix,
  initialName,
  onClose,
  onSubmitted,
}: MissingIngredientRequestPanelProps) {
  const proposedNameRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [proposedName, setProposedName] = useState(initialName);
  const [context, setContext] = useState("");
  const [fieldErrors, setFieldErrors] = useState<RequestFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    proposedNameRef.current?.focus();
  }, []);

  function clearFieldError(field: keyof RequestFieldErrors) {
    setFormError("");
    setStatusMessage("");
    setFieldErrors((current) => {
      if (!(field in current)) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function submitRequest() {
    if (submittingRef.current || pending || disabled || submitted) {
      return;
    }

    const errors = validateRequest(proposedName, context);
    setFieldErrors(errors);
    setFormError("");
    setStatusMessage("");
    if (Object.keys(errors).length > 0) {
      if (errors.proposedName) {
        proposedNameRef.current?.focus();
      }
      return;
    }

    submittingRef.current = true;
    setPending(true);
    try {
      const request = await submitMissingIngredientRequest({
        proposed_name: proposedName.trim(),
        context: context.trim() || null,
      });
      setSubmitted(true);
      onSubmitted?.(request);
      setStatusMessage(
        `${request.proposed_name} was submitted for review. It cannot be used in a recipe unless a curator approves it.`,
      );
    } catch (reason) {
      setFormError(
        reason instanceof IngredientCatalogApiError
          ? reason.message
          : "The ingredient request could not be submitted. Please try again.",
      );
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submitRequest();
    }
  }

  const nameHelpId = `${idPrefix}-request-name-help`;
  const nameErrorId = `${idPrefix}-request-name-error`;
  const contextHelpId = `${idPrefix}-request-context-help`;
  const contextErrorId = `${idPrefix}-request-context-error`;

  return (
    <section
      className="ingredient-request-panel"
      aria-busy={pending}
      aria-labelledby={`${idPrefix}-request-heading`}
    >
      <div className="ingredient-request-panel__header">
        <div>
          <h3 id={`${idPrefix}-request-heading`}>Request a missing ingredient</h3>
          <p>
            This sends a separate catalog request. It will not add the proposed name to your
            recipe or make it selectable before review.
          </p>
        </div>
        <button
          className="button button--quiet"
          type="button"
          disabled={pending || disabled}
          onClick={onClose}
        >
          {submitted ? "Close request" : "Cancel request"}
        </button>
      </div>

      <div className="recipe-form-field">
        <label htmlFor={`${idPrefix}-request-name`}>Proposed ingredient name</label>
        <input
          id={`${idPrefix}-request-name`}
          ref={proposedNameRef}
          type="text"
          value={proposedName}
          maxLength={200}
          disabled={pending || disabled || submitted}
          aria-invalid={Boolean(fieldErrors.proposedName)}
          aria-describedby={`${nameHelpId}${
            fieldErrors.proposedName ? ` ${nameErrorId}` : ""
          }`}
          onChange={(event) => {
            clearFieldError("proposedName");
            setProposedName(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        <small id={nameHelpId}>Use the clearest common name you know.</small>
        {fieldErrors.proposedName ? (
          <p id={nameErrorId} className="recipe-form-field-error">
            {fieldErrors.proposedName}
          </p>
        ) : null}
      </div>

      <div className="recipe-form-field">
        <label htmlFor={`${idPrefix}-request-context`}>Short context (optional)</label>
        <textarea
          id={`${idPrefix}-request-context`}
          value={context}
          rows={3}
          maxLength={500}
          disabled={pending || disabled || submitted}
          aria-invalid={Boolean(fieldErrors.context)}
          aria-describedby={`${contextHelpId}${fieldErrors.context ? ` ${contextErrorId}` : ""}`}
          onChange={(event) => {
            clearFieldError("context");
            setContext(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        <small id={contextHelpId}>
          Add enough detail to distinguish it from similar catalog ingredients. Maximum 500
          characters.
        </small>
        {fieldErrors.context ? (
          <p id={contextErrorId} className="recipe-form-field-error">
            {fieldErrors.context}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p className="ingredient-request-panel__alert" role="alert">
          {formError}
        </p>
      ) : null}
      <p className="ingredient-request-panel__status" role="status" aria-live="polite">
        {statusMessage}
      </p>

      <button
        className="button button--secondary"
        type="button"
        disabled={pending || disabled || submitted}
        onClick={() => void submitRequest()}
      >
        {submitted
          ? "Request submitted"
          : pending
            ? "Submitting request…"
            : "Submit catalog request"}
      </button>
    </section>
  );
}
