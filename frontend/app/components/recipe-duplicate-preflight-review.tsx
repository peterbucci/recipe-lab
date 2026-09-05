"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef } from "react";

import type {
  RecipeDuplicateDecision,
  RecipeDuplicatePreflight,
} from "../../lib/recipe-duplicate-api";
import { LoadingButton } from "./loading-ui";

interface RecipeDuplicatePreflightReviewProps {
  result: RecipeDuplicatePreflight;
  mode?: "variant" | "publication";
  publicationKind?: "original" | "fork";
  acknowledged: boolean;
  decisionFailure: RecipeDuplicateDecision | null;
  pendingDecision: "continue" | "revise" | null;
  confirmationSlot?: ReactNode;
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
  confirmationSlot,
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
  const publicationSubject = publishingFork ? "version" : "recipe";

  useEffect(() => {
    headingRef.current?.focus();
  }, [result.acknowledgement.preflight_id]);

  useEffect(() => {
    if (decisionFailure !== null) {
      decisionFailureRef.current?.focus();
    }
  }, [decisionFailure]);

  const heading = result.same_lineage_no_change
    ? publishing
      ? "This version is very close to its source"
      : "Your version matches the recipe it is based on"
    : result.classification === "exact_duplicate"
      ? publishing
        ? `This ${publicationSubject} is very close to another public recipe`
        : "Review a very similar recipe"
      : publishing
        ? `This ${publicationSubject} is similar to another public recipe`
        : "Review similar recipes";
  const publicationReasons = Array.from(
    new Map(
      result.candidates.flatMap((candidate) =>
        candidate.reasons.map((reason) => [
          reason.code,
          { code: reason.code, copy: reasonCopy(reason.code) },
        ] as const),
      ),
    ).values(),
  );
  const compactReasons =
    result.same_lineage_no_change && publicationReasons.length === 0
      ? [
          {
            code: "same_lineage_no_change",
            copy: "The ingredients, amounts, and cooking actions match its source.",
          },
        ]
      : publicationReasons;

  return (
    <section
      className={`duplicate-preflight-review duplicate-preflight-review--${mode}`}
      role="region"
      aria-labelledby={headingId}
      aria-busy={pending}
    >
      {publishing ? (
        <div className="duplicate-preflight-review__compact-summary">
          <div className="duplicate-preflight-review__compact-top">
            <span
              className="duplicate-preflight-review__compact-icon"
              aria-hidden="true"
            >
              !
            </span>
            <div>
              <h2 ref={headingRef} id={headingId} tabIndex={-1}>
                {heading}
              </h2>
              <p>
                {result.same_lineage_no_change
                  ? "You can still publish it as a separate version if that’s intentional."
                  : `You can still publish this ${publicationSubject} separately if that’s intentional.`}
              </p>
              {result.candidates.length > 0 ? (
                <p className="duplicate-preflight-review__compact-links">
                  {result.same_lineage_no_change ? "Also similar to " : "Similar to "}
                  {result.candidates.map((candidate, index) => (
                    <span key={candidate.public_recipe_version_id}>
                      {index > 0 ? ", " : null}
                      <Link
                        href={`/recipes/${candidate.public_recipe_version_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {candidate.title}
                        <span className="visually-hidden"> (opens in a new tab)</span>
                      </Link>
                    </span>
                  ))}
                  .
                </p>
              ) : null}
            </div>
          </div>
          {compactReasons.length > 0 ? (
            <details className="duplicate-preflight-review__compact-details">
              <summary>Why is Recipe Lab showing this?</summary>
              <ul>
                {compactReasons.map((reason) => (
                  <li key={reason.code}>{reason.copy}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : (
        <>
          <div className="duplicate-preflight-review__intro">
            <p className="eyebrow">Similar recipes</p>
            <h2 ref={headingRef} id={headingId} tabIndex={-1}>
              {heading}
            </h2>
            <p>
              Recipe Lab found similarities in the saved ingredients, amounts, and cooking
              actions. This comparison is only a guide. It cannot show who created an idea,
              explain an author&apos;s intent, or predict how either recipe will turn out. It does
              not merge recipes or prevent you from making your version.
            </p>
          </div>

          {result.warnings.map((warning) => (
            <p className="duplicate-preflight-review__warning" key={warning.code}>
              Your version matches the recipe it is based on.
            </p>
          ))}
        </>
      )}

      {!publishing && result.candidates.length > 0 ? (
        <ol
          className="duplicate-preflight-candidates duplicate-preflight-review__candidates"
          aria-label="Public recipe matches"
        >
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

      {confirmationSlot}

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
                      ? "I understand this version closely matches its source and want to publish it separately."
                      : "I reviewed these similar recipes and want to publish my version anyway."
                    : "I reviewed these similar recipes and want to publish my recipe anyway."
                  : "I reviewed these similar recipes and want to create my version anyway."}
              </span>
            </label>
            <div className="duplicate-preflight-review__actions">
              <LoadingButton
                className="button button--primary"
                type="button"
                disabled={!acknowledged || pendingDecision === "revise"}
                pending={pendingDecision === "continue"}
                pendingLabel={
                  publishing
                    ? publishingFork
                      ? "Publishing your version…"
                      : "Publishing your recipe…"
                    : "Recording your choice…"
                }
                onClick={onContinue}
              >
                {publishing
                  ? publishingFork
                    ? "Publish version"
                    : "Publish recipe"
                  : "Create my version anyway"}
              </LoadingButton>
              <LoadingButton
                className="button button--secondary"
                type="button"
                disabled={pendingDecision === "continue"}
                pending={pendingDecision === "revise"}
                pendingLabel="Returning to editing…"
                onClick={onRevise}
              >
                Keep editing
              </LoadingButton>
            </div>
            {pendingDecision === null ? (
              <p
                className={publishing ? "visually-hidden" : undefined}
                role="status"
                aria-live="polite"
              >
                Choose whether to continue or return to editing.
              </p>
            ) : null}
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
              <LoadingButton
                className="button button--primary"
                type="button"
                pending={pending}
                pendingLabel="Retrying your review choice…"
                onClick={onRetryDecision}
              >
                Retry recording my choice
              </LoadingButton>
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
            {!pending ? (
              <p role="status" aria-live="polite">
                No confirmed response was received for your review decision.
              </p>
            ) : null}
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
      className="duplicate-preflight-review duplicate-preflight-review--unavailable duplicate-preflight-unavailable"
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
        <LoadingButton
          className="button button--primary"
          type="button"
          disabled={pendingAction === "create"}
          pending={pendingAction === "retry"}
          pendingLabel="Checking similar recipes again…"
          onClick={onRetry}
        >
          Check similar recipes again
        </LoadingButton>
        <LoadingButton
          className="button button--secondary"
          type="button"
          disabled={pendingAction === "retry"}
          pending={pendingAction === "create"}
          pendingLabel="Creating without checking similar recipes…"
          onClick={onCreateWithoutReview}
        >
          Create without checking similar recipes
        </LoadingButton>
      </div>
      {pendingAction === null ? (
        <p className="duplicate-preflight-unavailable__status" role="status" aria-live="polite">
          No similar-recipes result is available.
        </p>
      ) : null}
    </section>
  );
}
