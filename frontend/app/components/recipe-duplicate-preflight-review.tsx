"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";

import type {
  RecipeDuplicateDecision,
  RecipeDuplicatePreflight,
} from "../../lib/recipe-duplicate-api";

interface RecipeDuplicatePreflightReviewProps {
  result: RecipeDuplicatePreflight;
  mode?: "variant" | "publication";
  publicationKind?: "original" | "fork";
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
  return classification === "exact_duplicate" ? "Very close match" : "Similar recipe";
}

const REASON_COPY: Readonly<Record<string, string>> = {
  exact_structural_match: "The ingredients, amounts, and cooking actions match.",
  same_ingredient_multiset: "The recipes use the same ingredients in the same counts.",
  same_curated_ingredient_multiset: "The recipes use the same ingredients in the same counts.",
  overlapping_ingredient_multisets: "The recipes share many of the same ingredients.",
  different_ingredient_multisets: "Some ingredients differ.",
  proportionally_scaled_quantities: "The matching ingredient amounts use one consistent scale.",
  matching_quantities: "The ingredient amounts match.",
  partially_matching_quantities: "Some ingredient amounts match.",
  different_quantities: "Some ingredient amounts differ.",
  matching_structured_actions: "The cooking actions, timing, and temperatures match.",
  similar_structured_action_flow: "The order of cooking actions is similar.",
  matching_structure: "The ingredients, amounts, and cooking actions are similar.",
  different_action_types: "Some cooking actions differ.",
  different_action_order: "The cooking actions appear in a different order.",
  different_ordered_inputs: "Some cooking actions use ingredients in a different order.",
  different_duration_or_temperature: "Some cooking times or temperatures differ.",
};

function reasonCopy(code: string): string {
  return REASON_COPY[code] ?? "Recipe details contributed to this match.";
}

export function RecipeDuplicatePreflightReview({
  result,
  mode = "variant",
  publicationKind = "original",
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
  const publishing = mode === "publication";
  const publishingFork = publishing && publicationKind === "fork";

  useEffect(() => {
    headingRef.current?.focus();
  }, [result.acknowledgement.preflight_id]);

  useEffect(() => {
    if (decisionFailure !== null) {
      decisionFailureRef.current?.focus();
    }
  }, [decisionFailure]);

  const heading = result.same_lineage_no_change
    ? "Your version matches the recipe it is based on"
    : result.classification === "exact_duplicate"
      ? "Review a very similar recipe"
      : "Review similar recipes";

  return (
    <section
      className="duplicate-preflight-review"
      role="region"
      aria-labelledby={headingId}
      aria-busy={pending}
    >
      <div className="duplicate-preflight-review__intro">
        <p className="eyebrow">Similar recipes</p>
        <h2 ref={headingRef} id={headingId} tabIndex={-1}>
          {heading}
        </h2>
        {publishingFork && result.same_lineage_no_change ? (
          <p>
            Recipe Lab compared this saved draft with the recipe it is based on. Publishing still
            creates a separate version and never changes or merges the starting recipe.
          </p>
        ) : (
          <p>
            Recipe Lab compares approved ingredients, amounts, and the order of cooking actions.
            This review does not merge recipes or prevent you from making
            {publishingFork
              ? " your version public."
              : publishing
                ? " your recipe public."
                : " your version."}
          </p>
        )}
      </div>

      {result.warnings.map((warning) => (
        <p className="duplicate-preflight-review__warning" key={warning.code}>
          Your version matches the recipe it is based on.
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
                  <li key={reason.code}>{reasonCopy(reason.code)}</li>
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
                {publishing
                    ? publishingFork
                    ? result.same_lineage_no_change
                      ? "I understand that my version matches the recipe it is based on and want to publish it anyway."
                      : "I reviewed these similar recipes and want to publish my version anyway."
                    : "I reviewed these similar recipes and want to publish my recipe anyway."
                  : "I reviewed these similar recipes and want to create my version anyway."}
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
                  ? publishing
                    ? publishingFork
                      ? "Publishing your version…"
                      : "Publishing your recipe…"
                    : "Recording your choice…"
                  : publishing
                    ? publishingFork
                      ? "Publish version anyway"
                      : "Publish recipe anyway"
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
                ? publishing
                  ? `Rechecking similar recipes and publishing your ${publishingFork ? "version" : "recipe"}.`
                  : "Recording your choice before creating the version."
                : pendingDecision === "revise"
                  ? "Recording your choice and keeping every draft field."
                  : "Choose whether to continue or return to editing."}
            </p>
          </>
        ) : (
          <div className="duplicate-decision-unavailable">
            <h3 ref={decisionFailureRef} tabIndex={-1}>
              Your review choice could not be confirmed
            </h3>
            <p>
              The similar-recipes results above remain visible, but Recipe Lab could not confirm
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
        <p className="eyebrow">Similar recipes</p>
        <h2 ref={headingRef} id={headingId} tabIndex={-1}>
          Similar recipes could not be checked
        </h2>
        <p>
          Recipe Lab could not check for similar recipes right now. This does not mean your
          version is different. Your entire draft is still here, and you can retry the check or
          explicitly continue without it.
        </p>
      </div>
      <div className="duplicate-preflight-review__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={pending}
          onClick={onRetry}
        >
          {pendingAction === "retry" ? "Checking similar recipes again…" : "Check similar recipes again"}
        </button>
        <button
          className="button button--secondary"
          type="button"
          disabled={pending}
          onClick={onCreateWithoutReview}
        >
          {pendingAction === "create"
            ? "Creating without checking similar recipes…"
            : "Create without checking similar recipes"}
        </button>
      </div>
      <p className="duplicate-preflight-unavailable__status" role="status" aria-live="polite">
        {pendingAction === "retry"
          ? "Checking for similar recipes again."
          : pendingAction === "create"
            ? "Creating your version without a completed similar-recipes check."
            : "No similar-recipes result is available."}
      </p>
    </section>
  );
}
