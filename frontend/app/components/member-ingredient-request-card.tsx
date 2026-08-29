import {
  type IngredientCatalogRequestStatus,
  type MemberIngredientRequest,
} from "../../lib/ingredient-catalog-api";

const STATUS_LABELS: Record<IngredientCatalogRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  duplicate: "Duplicate",
};

interface MemberIngredientRequestCardProps {
  contextLabel?: string;
  loading: boolean;
  request: MemberIngredientRequest;
  selectingRequestId: string | null;
  selectionEnabled: boolean;
  onSelectResolution: (request: MemberIngredientRequest) => Promise<void>;
}

function formatRequestTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
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

export function MemberIngredientRequestCard({
  contextLabel,
  loading,
  request,
  selectingRequestId,
  selectionEnabled,
  onSelectResolution,
}: MemberIngredientRequestCardProps) {
  const resolved = request.resolved_ingredient;
  const selectable =
    selectionEnabled &&
    resolved !== null &&
    (request.status === "approved" || request.status === "duplicate");

  return (
    <article
      className="member-request-card"
      aria-label={`Ingredient request: ${request.proposed_name}`}
    >
      <header className="member-request-card__header">
        <h3>{request.proposed_name}</h3>
        <span className={`curation-status curation-status--${request.status}`}>
          {STATUS_LABELS[request.status]}
        </span>
      </header>
      <dl className="member-request-card__facts">
        <div>
          <dt>Status</dt>
          <dd>{STATUS_LABELS[request.status]}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>
            <time dateTime={request.created_at}>{formatRequestTime(request.created_at)}</time>
          </dd>
        </div>
        {request.reviewed_at ? (
          <div>
            <dt>Reviewed</dt>
            <dd>
              <time dateTime={request.reviewed_at}>{formatRequestTime(request.reviewed_at)}</time>
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
        <button
          className="button button--secondary"
          type="button"
          disabled={loading || selectingRequestId !== null}
          onClick={() => void onSelectResolution(request)}
        >
          {selectingRequestId === request.id
            ? `Confirming ${resolved.canonical_name}…`
            : `Use ${resolved.canonical_name} for ${contextLabel}`}
        </button>
      ) : resolved ? (
        <p className="member-request-card__availability">
          This catalog resolution is available from an ingredient picker while you edit a recipe.
        </p>
      ) : null}
    </article>
  );
}
