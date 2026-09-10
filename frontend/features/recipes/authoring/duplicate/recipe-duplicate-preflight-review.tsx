"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef } from "react";

import type { RecipeDuplicatePreflight } from "./recipe-duplicate-api";
import { LoadingButton } from "../../../../shared/ui/loading-ui";

interface RecipeDuplicatePreflightReviewProps {
  result: RecipeDuplicatePreflight;
  publicationKind: "original" | "fork";
  acknowledged: boolean;
  pendingDecision: "continue" | null;
  confirmationSlot?: ReactNode;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onContinue: () => void;
  onRevise: () => void;
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
  publicationKind,
  acknowledged,
  pendingDecision,
  confirmationSlot,
  onAcknowledgedChange,
  onContinue,
  onRevise,
}: RecipeDuplicatePreflightReviewProps) {
  const headingId = useId();
  const acknowledgementId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pending = pendingDecision !== null;
  const publishingFork = publicationKind === "fork";
  const publicationSubject = publishingFork ? "version" : "recipe";

  useEffect(() => {
    headingRef.current?.focus();
  }, [result.acknowledgement.preflight_id]);

  const heading = result.same_lineage_no_change
    ? "This version is very close to its source"
    : result.classification === "exact_duplicate"
      ? `This ${publicationSubject} is very close to another public recipe`
      : `This ${publicationSubject} is similar to another public recipe`;
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
      className="duplicate-preflight-review duplicate-preflight-review--publication"
      role="region"
      aria-labelledby={headingId}
      aria-busy={pending}
    >
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

      {confirmationSlot}

      <div className="duplicate-preflight-review__decision">
        <label htmlFor={acknowledgementId}>
          <input
            id={acknowledgementId}
            type="checkbox"
            checked={acknowledged}
            disabled={pending}
            onChange={(event) =>
              onAcknowledgedChange(event.currentTarget.checked)
            }
          />
          <span>
            {publishingFork
              ? result.same_lineage_no_change
                ? "I understand this version closely matches its source and want to publish it separately."
                : "I reviewed these similar recipes and want to publish my version anyway."
              : "I reviewed these similar recipes and want to publish my recipe anyway."}
          </span>
        </label>
        <div className="duplicate-preflight-review__actions">
          <LoadingButton
            className="button button--primary"
            type="button"
            disabled={!acknowledged}
            pending={pending}
            pendingLabel={
              publishingFork
                ? "Publishing your version…"
                : "Publishing your recipe…"
            }
            onClick={onContinue}
          >
            {publishingFork ? "Publish version" : "Publish recipe"}
          </LoadingButton>
          <button
            className="button button--secondary"
            type="button"
            disabled={pending}
            onClick={onRevise}
          >
            Keep editing
          </button>
        </div>
        {!pending ? (
          <p className="visually-hidden" role="status" aria-live="polite">
            Choose whether to continue or return to editing.
          </p>
        ) : null}
      </div>
    </section>
  );
}
