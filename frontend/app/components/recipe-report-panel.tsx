"use client";

import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";

import { createIdempotencyKey } from "../../lib/idempotency-key";
import {
  RECIPE_REPORT_DETAILS_MAX_LENGTH,
  RecipeReportApiError,
  type RecipeReportReason,
  submitRecipeReport,
} from "../../lib/recipe-report-api";

const REPORT_REASONS: ReadonlyArray<{ value: RecipeReportReason; label: string }> = [
  { value: "spam", label: "Spam or misleading content" },
  { value: "harassment", label: "Harassment or hateful content" },
  { value: "dangerous_content", label: "Dangerous or illegal content" },
  { value: "intellectual_property", label: "Copyright or ownership concern" },
  { value: "other", label: "Something else" },
];

interface RecipeReportPanelProps {
  recipeVersionId: string;
}

function reportErrorMessage(error: RecipeReportApiError | null): string {
  if (error?.outcome === "unknown") {
    return "Recipe Lab could not confirm whether your report was received. Try again to safely check the same report; your details are still here.";
  }
  if (error?.status === 401) {
    return "Your session expired. Sign in again before reporting this recipe.";
  }
  if (error?.status === 404) return "This recipe is no longer available to report.";
  if (error?.status === 413) return "That report is too large. Shorten the details and try again.";
  if (error?.status === 422) return "Review the report reason and details, then try again.";
  if (error?.status === 429) {
    return error.retryAfterSeconds === null
      ? "Too many reports were submitted. Please wait before trying again."
      : `Too many reports were submitted. Try again in ${error.retryAfterSeconds} seconds.`;
  }
  return "Recipe Lab could not submit this report. Please try again.";
}

interface Attempt {
  fingerprint: string;
  idempotencyKey: string;
}

export function RecipeReportPanel({ recipeVersionId }: RecipeReportPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState<RecipeReportReason | "">("");
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLParagraphElement>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const submittingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || submitted) return;
    if (!reason) {
      setError("Choose a reason for the report.");
      window.setTimeout(() => errorRef.current?.focus(), 0);
      return;
    }
    const normalizedDetails = details.trim() || null;
    const fingerprint = JSON.stringify({ recipeVersionId, reason, details: normalizedDetails });
    if (attemptRef.current?.fingerprint !== fingerprint) {
      attemptRef.current = { fingerprint, idempotencyKey: createIdempotencyKey() };
    }
    submittingRef.current = true;
    setPending(true);
    setError("");
    setStatus("Sending your private report…");
    try {
      await submitRecipeReport(
        recipeVersionId,
        { reason, details: normalizedDetails },
        attemptRef.current.idempotencyKey,
      );
      setSubmitted(true);
      setStatus("Report received. Thank you for helping keep Recipe Lab safe.");
      window.setTimeout(() => successRef.current?.focus(), 0);
    } catch (caught) {
      const apiError = caught instanceof RecipeReportApiError ? caught : null;
      if (apiError?.code === "recipe_already_reported") {
        setSubmitted(true);
        setStatus("You already reported this recipe. The existing report is still in review.");
        window.setTimeout(() => successRef.current?.focus(), 0);
      } else {
        setError(reportErrorMessage(apiError));
        setStatus("");
        window.setTimeout(() => errorRef.current?.focus(), 0);
      }
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <section className="recipe-report" aria-label="Recipe reporting">
      <button
        ref={toggleRef}
        className="recipe-report__toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={`recipe-report-form-${recipeVersionId}`}
        onClick={() => {
          setExpanded((value) => !value);
          setError("");
        }}
      >
        {expanded ? "Close report form" : "Report recipe"}
      </button>
      {expanded ? (
        <div id={`recipe-report-form-${recipeVersionId}`} className="recipe-report__body">
          <h2 id={`recipe-report-title-${recipeVersionId}`}>Report this recipe</h2>
          <p>
            Reports are private. Recipe Lab shares no reporter identity with cooks or the public.
          </p>
          {submitted ? (
            <p
              className="form-success"
              role="status"
              aria-live="polite"
              tabIndex={-1}
              ref={successRef}
            >
              {status}
            </p>
          ) : (
            <form onSubmit={(event) => void submit(event)} noValidate>
              <fieldset aria-describedby={`recipe-report-help-${recipeVersionId}`}>
                <legend>Why are you reporting this recipe?</legend>
                <p id={`recipe-report-help-${recipeVersionId}`} className="field-help">
                  Choose the closest reason. A moderator will review the recipe in context.
                </p>
                <div className="recipe-report__reasons">
                  {REPORT_REASONS.map((option) => (
                    <label key={option.value}>
                      <input
                        type="radio"
                        name={`recipe-report-reason-${recipeVersionId}`}
                        value={option.value}
                        checked={reason === option.value}
                        onChange={() => {
                          setReason(option.value);
                          setError("");
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="form-field">
                <label htmlFor={`recipe-report-details-${recipeVersionId}`}>
                  Additional details (optional)
                </label>
                <textarea
                  id={`recipe-report-details-${recipeVersionId}`}
                  maxLength={RECIPE_REPORT_DETAILS_MAX_LENGTH}
                  value={details}
                  aria-describedby={`recipe-report-details-help-${recipeVersionId}`}
                  onChange={(event) => {
                    setDetails(event.target.value);
                    setError("");
                  }}
                />
                <small id={`recipe-report-details-help-${recipeVersionId}`}>
                  Do not include passwords, contact details, or other sensitive information. {details.length}/
                  {RECIPE_REPORT_DETAILS_MAX_LENGTH}
                </small>
              </div>
              {error ? (
                <div className="form-alert" role="alert" tabIndex={-1} ref={errorRef}>
                  {error}
                </div>
              ) : null}
              <div className="button-row">
                <button className="button button--primary" type="submit" disabled={pending}>
                  {pending ? "Submitting report…" : "Submit private report"}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setExpanded(false);
                    window.setTimeout(() => toggleRef.current?.focus(), 0);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          <p className="recipe-report__rules-link">
            Read the <Link href="/community-rules">community rules</Link>.
          </p>
          {!submitted && status ? (
            <p role="status" aria-live="polite">
              {status}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
