"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";

import type {
  RecipeDuplicateDecision,
  RecipeDuplicatePreflight,
} from "../../lib/recipe-duplicate-api";

interface RecipeDuplicatePreflightReviewProps {
  result: RecipeDuplicatePreflight;
  acknowledged: boolean;
  decisionFailure: RecipeDuplicateDecision | null;
  pendingDecision: "continue" | "revise" | null;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onContinue: () => void;
  onRevise: () => void;
  onRetryDecision: () => void;
  onCreateWithoutRecordedDecision: () => void;
  onReturnWithoutRecordedDecision: () => void;
}

interface RecipeDuplicateUnavailableProps {
  pendingAction: "retry" | "create" | null;
  onRetry: () => void;
  onCreateWithoutReview: () => void;
}

function classificationLabel(classification: "exact_duplicate" | "probable_duplicate") {
  return classification === "exact_duplicate" ? "Structural match" : "Similar structure";
}

export function RecipeDuplicatePreflightReview({
  result,
  acknowledged,
  decisionFailure,
  pendingDecision,
  onAcknowledgedChange,
  onContinue,
  onRevise,
  onRetryDecision,
  onCreateWithoutRecordedDecision,
  onReturnWithoutRecordedDecision,
}: RecipeDuplicatePreflightReviewProps) {
  const headingId = useId();
  const acknowledgementId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const decisionFailureRef = useRef<HTMLHeadingElement>(null);
  const pending = pendingDecision !== null;

  useEffect(() => {
    headingRef.current?.focus();
  }, [result.acknowledgement.preflight_id]);

  useEffect(() => {
    if (decisionFailure !== null) {
      decisionFailureRef.current?.focus();
    }
  }, [decisionFailure]);

  const heading = result.same_lineage_no_change
    ? "This version keeps the same recipe structure"
    : result.classification === "exact_duplicate"
      ? "Review an existing structural match"
      : "Review similar recipe structures";

  return (
    <section
      className="duplicate-preflight-review"
      role="region"
      aria-labelledby={headingId}
      aria-busy={pending}
    >
      <div className="duplicate-preflight-review__intro">
        <p className="eyebrow">Advisory similarity review</p>
        <h2 ref={headingRef} id={headingId} tabIndex={-1}>
          {heading}
        </h2>
        <p>
          Recipe Lab compares curated ingredients, normalized amounts, and structured
          cooking actions. This review does not merge recipes or prevent you from making
          your version.
        </p>
      </div>

      {result.warnings.map((warning) => (
        <p className="duplicate-preflight-review__warning" key={warning.code}>
          {warning.message}
        </p>
      ))}

      {result.candidates.length > 0 ? (
        <ol className="duplicate-preflight-candidates" aria-label="Public recipe matches">
          {result.candidates.map((candidate) => (
            <li key={candidate.public_recipe_version_id}>
              <div className="duplicate-preflight-candidate__heading">
                <div>
                  <span>{classificationLabel(candidate.classification)}</span>
                  <Link
                    href={`/recipes/${candidate.public_recipe_version_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {candidate.title}
                    <small>(opens in a new tab)</small>
                  </Link>
                </div>
                <strong>{Math.round(Number(candidate.score) * 100)}% similar</strong>
              </div>
              <ul aria-label={`Why ${candidate.title} was included`}>
                {candidate.reasons.map((reason) => (
                  <li key={reason.code}>{reason.message}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="duplicate-preflight-review__decision">
        {decisionFailure === null ? (
          <>
            <label htmlFor={acknowledgementId}>
              <input
                id={acknowledgementId}
                type="checkbox"
                checked={acknowledged}
                disabled={pending}
                onChange={(event) => onAcknowledgedChange(event.currentTarget.checked)}
              />
              <span>
                I reviewed these advisory results and want to create my version anyway.
              </span>
            </label>
            <div className="duplicate-preflight-review__actions">
              <button
                className="button button--primary"
                type="button"
                disabled={!acknowledged || pending}
                onClick={onContinue}
              >
                {pendingDecision === "continue"
                  ? "Recording your choice…"
                  : "Create my version anyway"}
              </button>
              <button
                className="button button--secondary"
                type="button"
                disabled={pending}
                onClick={onRevise}
              >
                {pendingDecision === "revise" ? "Returning to editing…" : "Keep editing"}
              </button>
            </div>
            <p role="status" aria-live="polite">
              {pendingDecision === "continue"
                ? "Recording your choice before creating the version."
                : pendingDecision === "revise"
                  ? "Recording your choice and keeping every draft field."
                  : "Choose whether to continue with this structure or return to editing."}
            </p>
          </>
        ) : (
          <div className="duplicate-decision-unavailable">
            <h3 ref={decisionFailureRef} tabIndex={-1}>
              Your review choice could not be confirmed
            </h3>
            <p>
              The advisory results above remain visible, but Recipe Lab could not confirm
              whether your choice was recorded. You can retry the same choice or
              explicitly continue without confirming the review decision.
            </p>
            <div className="duplicate-preflight-review__actions">
              <button
                className="button button--primary"
                type="button"
                disabled={pending}
                onClick={onRetryDecision}
              >
                {pending ? "Retrying your review choice…" : "Retry recording my choice"}
              </button>
              <button
                className="button button--secondary"
                type="button"
                disabled={pending}
                onClick={
                  decisionFailure === "continue"
                    ? onCreateWithoutRecordedDecision
                    : onReturnWithoutRecordedDecision
                }
              >
                {decisionFailure === "continue"
                  ? "Create without confirming the review decision"
                  : "Return to editing without confirming the review decision"}
              </button>
            </div>
            <p role="status" aria-live="polite">
              {pending
                ? "Retrying the same review choice."
                : "No confirmed response was received for your review decision."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export function RecipeDuplicateUnavailable({
  pendingAction,
  onRetry,
  onCreateWithoutReview,
}: RecipeDuplicateUnavailableProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pending = pendingAction !== null;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      className="duplicate-preflight-review duplicate-preflight-unavailable"
      role="region"
      aria-labelledby={headingId}
      aria-busy={pending}
    >
      <div className="duplicate-preflight-review__intro">
        <p className="eyebrow">Advisory similarity review</p>
        <h2 ref={headingRef} id={headingId} tabIndex={-1}>
          Similarity review could not be completed
        </h2>
        <p>
          Recipe Lab could not complete the structural comparison right now. This does
          not mean your version is distinct. Your entire draft is still here, and you can
          retry the review or explicitly continue without it.
        </p>
      </div>
      <div className="duplicate-preflight-review__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={pending}
          onClick={onRetry}
        >
          {pendingAction === "retry" ? "Retrying similarity review…" : "Retry similarity review"}
        </button>
        <button
          className="button button--secondary"
          type="button"
          disabled={pending}
          onClick={onCreateWithoutReview}
        >
          {pendingAction === "create"
            ? "Creating without similarity review…"
            : "Create without similarity review"}
        </button>
      </div>
      <p className="duplicate-preflight-unavailable__status" role="status" aria-live="polite">
        {pendingAction === "retry"
          ? "Retrying the advisory structural comparison."
          : pendingAction === "create"
            ? "Creating your version without a completed similarity review."
            : "No similarity classification was produced."}
      </p>
    </section>
  );
}
