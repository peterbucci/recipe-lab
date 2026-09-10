import type { MemberIngredientRequest } from "./ingredient-request-api";
import {
  formatIngredientRequestDate,
  ingredientRequestMemberStatusLabel,
} from "../ingredient-request-presentation";

interface MemberIngredientRequestCardProps {
  request: MemberIngredientRequest;
}

function StandaloneRequestResolution({ request }: { request: MemberIngredientRequest }) {
  if (request.status === "pending") {
    return <span className="member-request-card__pending-note">Waiting for curator review.</span>;
  }

  if (request.status === "rejected") {
    return (
      <>
        <strong>Not added</strong>
        <small>
          {request.decision_reason ??
            "This request did not include enough information for a catalog ingredient."}
        </small>
      </>
    );
  }

  if (!request.resolved_ingredient) {
    return (
      <>
        <strong>{request.status === "approved" ? "Approved" : "Matched"}</strong>
        <small>
          {request.decision_reason ??
            (request.status === "duplicate"
              ? "A curator matched this request to an ingredient that is already in the catalog."
              : "A curator added this ingredient to the catalog.")}
        </small>
      </>
    );
  }

  return (
    <>
      <strong>{request.resolved_ingredient.canonical_name}</strong>
      <small>
        {request.status === "duplicate"
          ? "Your request matched an existing ingredient"
          : "Added to the catalog"}
      </small>
      {request.resolved_ingredient.aliases.length > 0 ? (
        <small>Also known as: {request.resolved_ingredient.aliases.join(", ")}</small>
      ) : null}
      {request.decision_reason ? <small>{request.decision_reason}</small> : null}
    </>
  );
}

export function MemberIngredientRequestCard({
  request,
}: MemberIngredientRequestCardProps) {
  return (
    <article
      className="member-request-card member-request-card--row"
      aria-label={`Ingredient request: ${request.proposed_name}`}
    >
      <div className="member-request-card__request">
        <h3>{request.proposed_name}</h3>
        {request.context ? <p>Context: {request.context}</p> : null}
      </div>
      <span className={`curation-status curation-status--${request.status}`}>
        {ingredientRequestMemberStatusLabel(request.status)}
      </span>
      <time className="member-request-card__requested" dateTime={request.created_at}>
        {formatIngredientRequestDate(request.created_at)}
      </time>
      <div className="member-request-card__resolution">
        <StandaloneRequestResolution request={request} />
      </div>
    </article>
  );
}
