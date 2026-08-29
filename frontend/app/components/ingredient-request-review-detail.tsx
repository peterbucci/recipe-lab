import { useEffect, useRef } from "react";

import type { IngredientCatalogReviewDetail } from "../../lib/ingredient-catalog-api";
import { IngredientRequestDecisionForm } from "./ingredient-request-decision-form";
import {
  formatRequestTime,
  type ReviewDetailProps,
  STATUS_LABELS,
} from "./ingredient-request-review-model";

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
            {STATUS_LABELS[detail.status]}
          </span>
          <h2 id="curation-detail-heading" ref={headingRef} tabIndex={-1}>
            {detail.proposed_name}
          </h2>
        </div>
        <time dateTime={detail.created_at}>{formatRequestTime(detail.created_at)}</time>
      </header>

      <dl className="curation-request-facts">
        <div>
          <dt>Requested by</dt>
          <dd>
            {detail.requester.display_name}
            {detail.requester.handle ? <span>@{detail.requester.handle}</span> : null}
          </dd>
        </div>
        <div>
          <dt>Request ID</dt>
          <dd className="curation-request-id">{detail.id}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>
            <time dateTime={detail.updated_at}>{formatRequestTime(detail.updated_at)}</time>
          </dd>
        </div>
      </dl>

      <section className="curation-context" aria-labelledby="curation-context-heading">
        <h3 id="curation-context-heading">Member context</h3>
        <p>{detail.context ?? "No additional context was provided."}</p>
      </section>

      <CandidateSummary detail={detail} />
      <IngredientRequestDecisionForm {...props} />
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
      <p>
        These are review aids only. Similar text does not prove that two ingredients are the same.
      </p>
      {candidateCount === 0 ? (
        <p className="curation-candidates__empty">No likely catalog or request matches were found.</p>
      ) : (
        <ul className="curation-candidate-summary-list">
          {detail.catalog_candidates.map((candidate) => (
            <li key={`catalog-${candidate.id}`}>
              <strong>{candidate.canonical_name}</strong>
              <span>Catalog ingredient</span>
              {candidate.aliases.length ? (
                <small>Aliases: {candidate.aliases.join(", ")}</small>
              ) : null}
            </li>
          ))}
          {detail.request_candidates.map((candidate) => (
            <li key={`request-${candidate.id}`}>
              <strong>{candidate.proposed_name}</strong>
              <span>{STATUS_LABELS[candidate.status]} request</span>
              {candidate.approved_canonical_name ? (
                <small>Approved as: {candidate.approved_canonical_name}</small>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
