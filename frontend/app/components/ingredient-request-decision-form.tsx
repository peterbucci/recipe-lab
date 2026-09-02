import { type FormEvent, useRef, useState } from "react";

import {
  type DuplicateIngredientCatalogRequestInput,
  IngredientCatalogApiError,
  type IngredientCatalogReviewDetail,
  type IngredientCatalogReviewInput,
  reviewIngredientCatalogRequest,
} from "../../lib/ingredient-catalog-api";
import { DuplicateTargetSearch } from "./ingredient-request-duplicate-target-search";
import {
  formatRequestTime,
  type ReviewDetailProps,
  STATUS_LABELS,
} from "./ingredient-request-review-model";
import { LoadingButton } from "./loading-ui";

interface ReviewFieldErrors {
  aliases?: string;
  canonicalName?: string;
  provenance?: string;
  reason?: string;
  target?: string;
}

type ReviewDecision = IngredientCatalogReviewInput["decision"];

const DECISION_ACTION_LABELS: Record<ReviewDecision, string> = {
  approve: "Approve request",
  duplicate: "Mark as duplicate",
  reject: "Reject request",
};

const DECISION_PENDING_LABELS: Record<ReviewDecision, string> = {
  approve: "Approving request…",
  duplicate: "Marking as duplicate…",
  reject: "Rejecting request…",
};

function validateReview({
  aliases,
  canonicalName,
  decision,
  duplicateTarget,
  provenance,
  reason,
}: {
  aliases: string[];
  canonicalName: string;
  decision: ReviewDecision;
  duplicateTarget: string;
  provenance: string;
  reason: string;
}): ReviewFieldErrors {
  const errors: ReviewFieldErrors = {};
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    errors.reason = "Enter a reason for this catalog decision.";
  } else if (trimmedReason.length > 1_000) {
    errors.reason = "Decision reason must be 1,000 characters or fewer.";
  }

  if (decision === "approve") {
    const trimmedCanonical = canonicalName.trim();
    if (!trimmedCanonical) {
      errors.canonicalName = "Enter the reviewed canonical ingredient name.";
    } else if (trimmedCanonical.length > 200) {
      errors.canonicalName = "Canonical name must be 200 characters or fewer.";
    }
    const reviewedAliases = aliases.map((alias) => alias.trim()).filter(Boolean);
    if (reviewedAliases.some((alias) => alias.length > 200)) {
      errors.aliases = "Each alias must be 200 characters or fewer.";
    } else {
      const normalized = reviewedAliases.map((alias) => alias.toLocaleLowerCase());
      if (new Set(normalized).size !== normalized.length) {
        errors.aliases = "Approved aliases must be unique.";
      } else if (trimmedCanonical && normalized.includes(trimmedCanonical.toLocaleLowerCase())) {
        errors.aliases = "The canonical name cannot also be an alias.";
      }
    }
    const trimmedProvenance = provenance.trim();
    if (!trimmedProvenance) {
      errors.provenance = "Describe the source or basis for this approval.";
    } else if (trimmedProvenance.length > 1_000) {
      errors.provenance = "Provenance must be 1,000 characters or fewer.";
    }
  }

  if (decision === "duplicate" && !duplicateTarget) {
    errors.target = "Choose the existing ingredient or approved request this duplicates.";
  }
  return errors;
}

export function IngredientRequestDecisionForm({
  detail,
  onAuthorizationLost,
  onRefresh,
  onReviewed,
}: ReviewDetailProps) {
  const submittingRef = useRef(false);
  const [decision, setDecision] = useState<ReviewDecision>("approve");
  const [canonicalName, setCanonicalName] = useState(detail.proposed_name);
  const [aliases, setAliases] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [provenance, setProvenance] = useState("");
  const [duplicateTarget, setDuplicateTarget] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReviewFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [staleConflict, setStaleConflict] = useState(false);

  const fieldId = (name: string) => `catalog-review-${detail.id}-${name}`;

  function focusFirstInvalid(errors: ReviewFieldErrors) {
    const target = ["canonicalName", "aliases", "reason", "provenance", "target"].find(
      (field) => field in errors,
    );
    if (target) {
      window.setTimeout(() => document.getElementById(fieldId(target))?.focus(), 0);
    }
  }

  function clearError(field: keyof ReviewFieldErrors) {
    setFormError("");
    setFieldErrors((current) => {
      if (!(field in current)) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function payload(): IngredientCatalogReviewInput {
    const normalizedReason = reason.trim();
    if (decision === "approve") {
      return {
        decision,
        canonical_name: canonicalName.trim(),
        aliases: aliases.map((alias) => alias.trim()).filter(Boolean),
        reason: normalizedReason,
        provenance: provenance.trim(),
      };
    }
    if (decision === "reject") {
      return { decision, reason: normalizedReason };
    }
    const [kind, id] = duplicateTarget.split(":", 2);
    const duplicate: DuplicateIngredientCatalogRequestInput = {
      decision,
      reason: normalizedReason,
      ingredient_id: kind === "ingredient" ? id : null,
      request_id: kind === "request" ? id : null,
    };
    return duplicate;
  }

  function serverFieldErrors(error: IngredientCatalogApiError): ReviewFieldErrors {
    const errors: ReviewFieldErrors = {};
    for (const issue of error.issues) {
      const field = issue.location.at(-1);
      if (field === "canonical_name") errors.canonicalName = issue.message;
      if (field === "aliases" || typeof field === "number") errors.aliases = issue.message;
      if (field === "reason") errors.reason = issue.message;
      if (field === "provenance") errors.provenance = issue.message;
      if (field === "ingredient_id" || field === "request_id") errors.target = issue.message;
    }
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || pending || detail.status !== "pending") {
      return;
    }
    const errors = validateReview({
      aliases,
      canonicalName,
      decision,
      duplicateTarget,
      provenance,
      reason,
    });
    setFieldErrors(errors);
    setFormError("");
    if (Object.keys(errors).length) {
      focusFirstInvalid(errors);
      return;
    }

    submittingRef.current = true;
    setPending(true);
    try {
      const updated = await reviewIngredientCatalogRequest(detail.id, payload());
      setStaleConflict(false);
      onReviewed(updated);
    } catch (reasonCaught) {
      if (reasonCaught instanceof IngredientCatalogApiError) {
        if (reasonCaught.status === 403) {
          onAuthorizationLost();
          return;
        }
        if (reasonCaught.status === 409) {
          setStaleConflict(true);
          setFormError(
            "This request or its catalog matches changed while you were reviewing it. Your entered review is still here.",
          );
        } else if (reasonCaught.status === 422) {
          const serverErrors = serverFieldErrors(reasonCaught);
          setFieldErrors(serverErrors);
          if (Object.keys(serverErrors).length) {
            focusFirstInvalid(serverErrors);
          } else {
            setFormError("Check the review fields and try again.");
          }
        } else {
          setFormError("The ingredient review could not be saved. Please try again.");
        }
      } else {
        setFormError("The ingredient review could not be saved. Please try again.");
      }
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  async function refreshAfterConflict() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  if (detail.status !== "pending" && !staleConflict) {
    return <RecordedDecision detail={detail} />;
  }

  const formDisabled = pending || detail.status !== "pending";
  const approvedRequestCandidates = detail.request_candidates.filter(
    (candidate) => candidate.status === "approved" && candidate.resolved_ingredient_id,
  );
  const openRequestCandidates = detail.request_candidates.filter(
    (candidate) => candidate.status !== "approved",
  );

  return (
    <section
      className="staff-workspace__decision curation-decision"
      aria-labelledby={fieldId("heading")}
    >
      <h3 id={fieldId("heading")}>
        {detail.status === "pending" ? "Decision" : "Your unsubmitted review"}
      </h3>
      {detail.status !== "pending" ? <RecordedDecision detail={detail} compact /> : null}
      {formError ? (
        <div
          className="staff-workspace__notice staff-workspace__notice--error curation-form-alert"
          role="alert"
        >
          <p>{formError}</p>
          {staleConflict ? (
            <LoadingButton
              className="button button--secondary"
              type="button"
              pending={refreshing}
              pendingLabel="Loading current request…"
              onClick={() => void refreshAfterConflict()}
            >
              Load current request
            </LoadingButton>
          ) : null}
        </div>
      ) : null}

      <form className="curation-form" noValidate aria-busy={pending} onSubmit={handleSubmit}>
        <fieldset
          className="curation-decision-options curation-decision-tabs"
          disabled={formDisabled}
        >
          <legend className="visually-hidden">Choose a decision</legend>
          <label className="curation-decision-tab">
            <input
              type="radio"
              name={`decision-${detail.id}`}
              value="approve"
              checked={decision === "approve"}
              onChange={() => setDecision("approve")}
            />
            <span>Approve</span>
          </label>
          <label className="curation-decision-tab">
            <input
              type="radio"
              name={`decision-${detail.id}`}
              value="duplicate"
              checked={decision === "duplicate"}
              onChange={() => setDecision("duplicate")}
            />
            <span>Duplicate</span>
          </label>
          <label className="curation-decision-tab">
            <input
              type="radio"
              name={`decision-${detail.id}`}
              value="reject"
              checked={decision === "reject"}
              onChange={() => setDecision("reject")}
            />
            <span>Reject</span>
          </label>
        </fieldset>

        {decision === "approve" ? (
          <>
            <div className="curation-field">
              <label htmlFor={fieldId("canonicalName")}>Canonical ingredient name</label>
              <input
                id={fieldId("canonicalName")}
                type="text"
                maxLength={200}
                value={canonicalName}
                disabled={formDisabled}
                aria-invalid={Boolean(fieldErrors.canonicalName)}
                aria-describedby={
                  fieldErrors.canonicalName ? fieldId("canonicalName-error") : undefined
                }
                onChange={(event) => {
                  clearError("canonicalName");
                  setCanonicalName(event.target.value);
                }}
              />
              {fieldErrors.canonicalName ? (
                <p id={fieldId("canonicalName-error")} className="curation-field-error">
                  {fieldErrors.canonicalName}
                </p>
              ) : null}
            </div>

            <fieldset className="curation-aliases" disabled={formDisabled}>
              <legend>Aliases (optional)</legend>
              <p>Aliases become searchable labels for the same canonical identity.</p>
              <span id={fieldId("aliases")} tabIndex={-1} />
              {aliases.map((alias, index) => (
                <div className="curation-alias-row" key={index}>
                  <label className="visually-hidden" htmlFor={fieldId(`alias-${index}`)}>
                    Alias {index + 1}
                  </label>
                  <input
                    id={fieldId(`alias-${index}`)}
                    type="text"
                    maxLength={200}
                    value={alias}
                    aria-invalid={Boolean(fieldErrors.aliases)}
                    onChange={(event) => {
                      clearError("aliases");
                      setAliases((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index ? event.target.value : value,
                        ),
                      );
                    }}
                  />
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() =>
                      setAliases((current) => current.filter((_, item) => item !== index))
                    }
                  >
                    Remove alias {index + 1}
                  </button>
                </div>
              ))}
              {fieldErrors.aliases ? (
                <p className="curation-field-error">{fieldErrors.aliases}</p>
              ) : null}
              <button
                className="button button--quiet"
                type="button"
                disabled={formDisabled || aliases.length >= 20}
                onClick={() => setAliases((current) => [...current, ""])}
              >
                Add alias
              </button>
            </fieldset>
          </>
        ) : null}

        {decision === "duplicate" ? (
          <fieldset
            className="curation-duplicate-targets"
            disabled={formDisabled}
            aria-describedby={fieldErrors.target ? fieldId("target-error") : undefined}
          >
            <legend id={fieldId("target")} tabIndex={-1}>
              Duplicate target
            </legend>
            {detail.catalog_candidates.length === 0 &&
            approvedRequestCandidates.length === 0 ? (
              <p>No eligible duplicate targets were suggested for this request.</p>
            ) : (
              <div className="curation-target-list">
                {detail.catalog_candidates.map((candidate) => (
                  <label key={`target-ingredient-${candidate.id}`}>
                    <input
                      type="radio"
                      name={`duplicate-target-${detail.id}`}
                      value={`ingredient:${candidate.id}`}
                      checked={duplicateTarget === `ingredient:${candidate.id}`}
                      onChange={(event) => {
                        clearError("target");
                        setDuplicateTarget(event.target.value);
                      }}
                    />
                    <span>
                      <strong>{candidate.canonical_name}</strong>
                      <small>Existing catalog ingredient</small>
                    </span>
                  </label>
                ))}
                {approvedRequestCandidates.map((candidate) => (
                  <label key={`target-request-${candidate.id}`}>
                    <input
                      type="radio"
                      name={`duplicate-target-${detail.id}`}
                      value={`request:${candidate.id}`}
                      checked={duplicateTarget === `request:${candidate.id}`}
                      onChange={(event) => {
                        clearError("target");
                        setDuplicateTarget(event.target.value);
                      }}
                    />
                    <span>
                      <strong>{candidate.approved_canonical_name ?? candidate.proposed_name}</strong>
                      <small>Already approved request</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {openRequestCandidates.length ? (
              <p>
                {openRequestCandidates.length} open or unresolved request
                {openRequestCandidates.length === 1 ? " is" : "s are"} shown above for context but
                cannot be selected as a duplicate target.
              </p>
            ) : null}
            <DuplicateTargetSearch
              detail={detail}
              disabled={formDisabled}
              inputName={`duplicate-target-${detail.id}`}
              value={duplicateTarget}
              onSelect={(target) => {
                clearError("target");
                setDuplicateTarget(target);
              }}
            />
            {fieldErrors.target ? (
              <p id={fieldId("target-error")} className="curation-field-error">
                {fieldErrors.target}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <div className="curation-field">
          <label htmlFor={fieldId("reason")}>Decision reason</label>
          <textarea
            id={fieldId("reason")}
            rows={3}
            maxLength={1_000}
            value={reason}
            disabled={formDisabled}
            aria-invalid={Boolean(fieldErrors.reason)}
            aria-describedby={`${fieldId("reason-help")}${
              fieldErrors.reason ? ` ${fieldId("reason-error")}` : ""
            }`}
            onChange={(event) => {
              clearError("reason");
              setReason(event.target.value);
            }}
          />
          <small id={fieldId("reason-help")}>
            Shown to the requesting member. Do not include private reviewer notes or personal
            information.
          </small>
          {fieldErrors.reason ? (
            <p id={fieldId("reason-error")} className="curation-field-error">
              {fieldErrors.reason}
            </p>
          ) : null}
        </div>

        {decision === "approve" ? (
          <div className="curation-field">
            <label htmlFor={fieldId("provenance")}>Approval provenance</label>
            <textarea
              id={fieldId("provenance")}
              rows={3}
              maxLength={1_000}
              value={provenance}
              disabled={formDisabled}
              aria-invalid={Boolean(fieldErrors.provenance)}
              aria-describedby={`${fieldId("provenance-help")}${
                fieldErrors.provenance ? ` ${fieldId("provenance-error")}` : ""
              }`}
              onChange={(event) => {
                clearError("provenance");
                setProvenance(event.target.value);
              }}
            />
            <small id={fieldId("provenance-help")}>
              Record the source or review basis that supports this catalog identity.
            </small>
            {fieldErrors.provenance ? (
              <p id={fieldId("provenance-error")} className="curation-field-error">
                {fieldErrors.provenance}
              </p>
            ) : null}
          </div>
        ) : null}

        <LoadingButton
          className="button button--primary curation-decision-submit"
          type="submit"
          disabled={detail.status !== "pending"}
          pending={pending}
          pendingLabel={DECISION_PENDING_LABELS[decision]}
        >
          {DECISION_ACTION_LABELS[decision]}
        </LoadingButton>
      </form>
    </section>
  );
}

function RecordedDecision({
  compact = false,
  detail,
}: {
  compact?: boolean;
  detail: IngredientCatalogReviewDetail;
}) {
  return (
    <section
      className={`curation-recorded${compact ? " curation-recorded--compact" : ""}`}
      aria-labelledby={`recorded-decision-${detail.id}`}
    >
      <h3 id={`recorded-decision-${detail.id}`}>Recorded decision</h3>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{STATUS_LABELS[detail.status]}</dd>
        </div>
        {detail.decision_reason ? (
          <div>
            <dt>Reason</dt>
            <dd>{detail.decision_reason}</dd>
          </div>
        ) : null}
        {detail.approved_canonical_name ? (
          <div>
            <dt>Canonical name</dt>
            <dd>{detail.approved_canonical_name}</dd>
          </div>
        ) : null}
        {detail.approved_aliases?.length ? (
          <div>
            <dt>Aliases</dt>
            <dd>{detail.approved_aliases.join(", ")}</dd>
          </div>
        ) : null}
        {detail.approval_provenance ? (
          <div>
            <dt>Provenance</dt>
            <dd>{detail.approval_provenance}</dd>
          </div>
        ) : null}
        {detail.reviewed_at ? (
          <div>
            <dt>Reviewed</dt>
            <dd>
              <time dateTime={detail.reviewed_at}>{formatRequestTime(detail.reviewed_at)}</time>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
