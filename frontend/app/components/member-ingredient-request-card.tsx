import {
  type MemberIngredientRequest,
} from "../../lib/ingredient-catalog-api";
import {
  formatIngredientRequestDate,
  formatIngredientRequestTime,
  ingredientRequestMemberStatusLabel,
  INGREDIENT_REQUEST_STATUS_LABELS,
} from "../../lib/ingredient-request-presentation";
import { LoadingButton } from "./loading-ui";

interface MemberIngredientRequestCardProps {
  contextLabel?: string;
  loading: boolean;
  request: MemberIngredientRequest;
  selectingRequestId: string | null;
  selectionEnabled: boolean;
  standalone: boolean;
  onSelectResolution: (request: MemberIngredientRequest) => Promise<void>;
}

function requestGuidance(request: MemberIngredientRequest): string {
  if (request.status === "pending") {
    return "Waiting for curator review. The proposed text is not a catalog ingredient.";
  }
  if (request.status === "rejected") {
    return "This request was not added to the catalog and cannot be selected in a recipe.";
  }
  if (request.status === "duplicate") {
    return "A curator matched this request to an ingredient that is already in the catalog.";
  }
  return "A curator added this ingredient to the catalog.";
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
        <small>{request.decision_reason ?? requestGuidance(request)}</small>
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
  contextLabel,
  loading,
  request,
  selectingRequestId,
  selectionEnabled,
  standalone,
  onSelectResolution,
}: MemberIngredientRequestCardProps) {
  const resolved = request.resolved_ingredient;
  const selectable =
    selectionEnabled &&
    resolved !== null &&
    (request.status === "approved" || request.status === "duplicate");

  if (standalone) {
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

  return (
    <article
      className="member-request-card"
      aria-label={`Ingredient request: ${request.proposed_name}`}
    >
      <header className="member-request-card__header">
        <h3>{request.proposed_name}</h3>
        <span className={`curation-status curation-status--${request.status}`}>
          {INGREDIENT_REQUEST_STATUS_LABELS[request.status]}
        </span>
      </header>
      <dl className="member-request-card__facts">
        <div>
          <dt>Status</dt>
          <dd>{INGREDIENT_REQUEST_STATUS_LABELS[request.status]}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>
            <time dateTime={request.created_at}>
              {formatIngredientRequestTime(request.created_at)}
            </time>
          </dd>
        </div>
        {request.reviewed_at ? (
          <div>
            <dt>Reviewed</dt>
            <dd>
              <time dateTime={request.reviewed_at}>
                {formatIngredientRequestTime(request.reviewed_at)}
              </time>
            </dd>
          </div>
        ) : null}
        {request.context ? (
          <div className="member-request-card__wide">
            <dt>Context</dt>
            <dd>{request.context}</dd>
          </div>
        ) : null}
        {request.decision_reason ? (
          <div className="member-request-card__wide">
            <dt>Decision reason</dt>
            <dd>{request.decision_reason}</dd>
          </div>
        ) : null}
        {resolved ? (
          <div className="member-request-card__wide">
            <dt>Resolved ingredient</dt>
            <dd>
              <strong>{resolved.canonical_name}</strong>
              {resolved.aliases.length > 0 ? (
                <small>Also known as: {resolved.aliases.join(", ")}</small>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="member-request-card__guidance">{requestGuidance(request)}</p>
      {selectable && resolved && contextLabel ? (
        <LoadingButton
          className="button button--secondary"
          type="button"
          disabled={
            loading ||
            (selectingRequestId !== null && selectingRequestId !== request.id)
          }
          pending={selectingRequestId === request.id}
          pendingLabel={`Confirming ${resolved.canonical_name}…`}
          onClick={() => void onSelectResolution(request)}
        >
          Use {resolved.canonical_name} for {contextLabel}
        </LoadingButton>
      ) : resolved ? (
        <p className="member-request-card__availability">
          This catalog resolution is available from an ingredient picker while you edit a recipe.
        </p>
      ) : null}
    </article>
  );
}
