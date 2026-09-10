import type { MemberIngredientRequestPage } from "./ingredient-request-api";
import { MemberIngredientRequestCard } from "./member-ingredient-request-card";
import { WorkspacePagination } from "../../../shared/ui/workspace-pagination";

interface MemberIngredientRequestListProps {
  loading: boolean;
  requestPage: MemberIngredientRequestPage;
  onChangePage: (page: number) => void;
}

export function MemberIngredientRequestList({
  loading,
  requestPage,
  onChangePage,
}: MemberIngredientRequestListProps) {
  return (
    <>
      <p
        className="member-request-history__summary visually-hidden"
        role="status"
        aria-live="polite"
      >
        {requestPage.total} request{requestPage.total === 1 ? "" : "s"}. Page {requestPage.page} of{" "}
        {requestPage.total_pages}.
      </p>
      <div className="member-request-history__list-head" aria-hidden="true">
        <span>Ingredient request</span>
        <span>Status</span>
        <span>Requested</span>
        <span>Resolution</span>
      </div>
      <div
        className="member-request-history__list member-request-history__list--standalone"
        aria-busy={loading}
      >
        {requestPage.items.map((request) => (
          <MemberIngredientRequestCard key={request.id} request={request} />
        ))}
      </div>

      <WorkspacePagination
        buttonClassName="button button--quiet"
        className="member-request-history__pagination"
        currentPage={requestPage.page}
        label="My ingredient requests pages"
        onPageChange={onChangePage}
        totalPages={requestPage.total_pages}
      />
    </>
  );
}
