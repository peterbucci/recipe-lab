import type {
  MemberIngredientRequest,
  MemberIngredientRequestPage,
} from "../../lib/ingredient-catalog-api";
import { MemberIngredientRequestCard } from "./member-ingredient-request-card";

interface MemberIngredientRequestListProps {
  contextLabel?: string;
  loading: boolean;
  regionLabel: string;
  requestPage: MemberIngredientRequestPage;
  selectingRequestId: string | null;
  selectionEnabled: boolean;
  onChangePage: (page: number) => void;
  onSelectResolution: (request: MemberIngredientRequest) => Promise<void>;
}

export function MemberIngredientRequestList({
  contextLabel,
  loading,
  regionLabel,
  requestPage,
  selectingRequestId,
  selectionEnabled,
  onChangePage,
  onSelectResolution,
}: MemberIngredientRequestListProps) {
  return (
    <>
      <p className="member-request-history__summary" role="status" aria-live="polite">
        {requestPage.total} request{requestPage.total === 1 ? "" : "s"}. Page {requestPage.page} of{" "}
        {requestPage.total_pages}.
      </p>
      <div className="member-request-history__list">
        {requestPage.items.map((request) => (
          <MemberIngredientRequestCard
            key={request.id}
            contextLabel={contextLabel}
            loading={loading}
            request={request}
            selectingRequestId={selectingRequestId}
            selectionEnabled={selectionEnabled}
            onSelectResolution={onSelectResolution}
          />
        ))}
      </div>

      {requestPage.total_pages > 1 ? (
        <nav className="member-request-history__pagination" aria-label={`${regionLabel} pages`}>
          <button
            className="button button--quiet"
            type="button"
            disabled={requestPage.page <= 1}
            onClick={() => onChangePage(requestPage.page - 1)}
          >
            ← Previous
          </button>
          <span aria-current="page">
            Page {requestPage.page} of {requestPage.total_pages}
          </span>
          <button
            className="button button--quiet"
            type="button"
            disabled={requestPage.page >= requestPage.total_pages}
            onClick={() => onChangePage(requestPage.page + 1)}
          >
            Next →
          </button>
        </nav>
      ) : null}
    </>
  );
}
