import { useEffect, useRef } from "react";

import type { IngredientCatalogReviewDetail } from "../../lib/ingredient-catalog-api";
import {
  formatIngredientRequestTime,
  INGREDIENT_REQUEST_STATUS_LABELS,
} from "../../lib/ingredient-request-presentation";
import { IngredientRequestDecisionForm } from "./ingredient-request-decision-form";
import { type ReviewDetailProps } from "./ingredient-request-review-model";

export function IngredientRequestReviewDetail(props: ReviewDetailProps) {
  const { detail } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [detail.id]);

  return (
    <article className="curation-detail__article" aria-labelledby="curation-detail-heading">
      <header className="curation-detail__header">
        <div>
          <span className={`curation-status curation-status--${detail.status}`}>
            {INGREDIENT_REQUEST_STATUS_LABELS[detail.status]}
          </span>
          <h2 id="curation-detail-heading" ref={headingRef} tabIndex={-1}>
            {detail.proposed_name}
          </h2>
        </div>
        <time dateTime={detail.created_at}>
          {formatIngredientRequestTime(detail.created_at)}
        </time>
      </header>

      <p className="curation-requester">
        Requested by <strong>{detail.requester.display_name}</strong>
        {detail.requester.handle ? (
          <>
            {" "}
            <span>@{detail.requester.handle}</span>
          </>
        ) : null}
      </p>

      <section className="curation-context" aria-labelledby="curation-context-heading">
        <h3 id="curation-context-heading">Member context</h3>
        <p>{detail.context ?? "No additional context was provided."}</p>
      </section>

      <CandidateSummary detail={detail} />
      <IngredientRequestDecisionForm {...props} />

      <details className="curation-request-more">
        <summary>More request details</summary>
        <dl className="curation-request-more__facts">
          <div>
            <dt>Request ID</dt>
            <dd className="curation-request-id">{detail.id}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>
              <time dateTime={detail.updated_at}>
                {formatIngredientRequestTime(detail.updated_at)}
              </time>
            </dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function CandidateSummary({ detail }: { detail: IngredientCatalogReviewDetail }) {
  const candidateCount = detail.catalog_candidates.length + detail.request_candidates.length;
  return (
    <section className="curation-candidates" aria-labelledby="curation-candidates-heading">
      <div className="curation-section-heading">
        <h3 id="curation-candidates-heading">Possible matches</h3>
        <span>{candidateCount}</span>
      </div>
      <p>Suggestions only; similarity does not establish identity.</p>
      {candidateCount === 0 ? (
        <p className="curation-candidates__empty">
          No likely catalog or reviewed-request matches were found.
        </p>
      ) : (
        <ul className="curation-candidate-summary-list">
          {detail.catalog_candidates.map((candidate) => (
            <li key={`catalog-${candidate.id}`}>
              <div>
                <strong>{candidate.canonical_name}</strong>
                <small>Catalog ingredient</small>
                {candidate.aliases.length ? (
                  <small>Aliases: {candidate.aliases.join(", ")}</small>
                ) : null}
              </div>
              <span className="curation-candidate-summary-list__type">Possible match</span>
            </li>
          ))}
          {detail.request_candidates.map((candidate) => (
            <li key={`request-${candidate.id}`}>
              <div>
                <strong>{candidate.proposed_name}</strong>
                <small>
                  {INGREDIENT_REQUEST_STATUS_LABELS[candidate.status]} request
                </small>
                {candidate.approved_canonical_name ? (
                  <small>Approved as: {candidate.approved_canonical_name}</small>
                ) : null}
              </div>
              <span className="curation-candidate-summary-list__type">Possible match</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
