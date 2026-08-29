import type {
  IngredientCatalogRequestStatus,
  IngredientCatalogReviewPage,
} from "../../lib/ingredient-catalog-api";
import {
  formatRequestTime,
  STATUS_FILTERS,
  STATUS_LABELS,
} from "./ingredient-request-review-model";

interface IngredientRequestStatusFiltersProps {
  requestStatus: IngredientCatalogRequestStatus;
  onChangeStatus: (status: IngredientCatalogRequestStatus) => void;
}

export function IngredientRequestStatusFilters({
  requestStatus,
  onChangeStatus,
}: IngredientRequestStatusFiltersProps) {
  return (
    <nav className="curation-filters" aria-label="Ingredient request status filters">
      {STATUS_FILTERS.map((filter) => (
        <button
          className="curation-filter"
          type="button"
          key={filter.value}
          aria-pressed={requestStatus === filter.value}
          onClick={() => onChangeStatus(filter.value)}
        >
          {filter.label}
        </button>
      ))}
    </nav>
  );
}

interface IngredientRequestReviewQueueProps {
  queue: IngredientCatalogReviewPage | null;
  queueError: string;
  queueLoading: boolean;
  requestStatus: IngredientCatalogRequestStatus;
  selectedRequestId: string | null;
  onChangePage: (page: number) => void;
  onReloadQueue: () => void;
  onSelectRequest: (requestId: string | null) => void;
}

export function IngredientRequestReviewQueue({
  queue,
  queueError,
  queueLoading,
  requestStatus,
  selectedRequestId,
  onChangePage,
  onReloadQueue,
  onSelectRequest,
}: IngredientRequestReviewQueueProps) {
  return (
    <section className="curation-queue" aria-labelledby="curation-queue-heading">
      <div className="curation-panel-heading">
        <div>
          <p className="eyebrow">{STATUS_LABELS[requestStatus]}</p>
          <h2 id="curation-queue-heading">Request queue</h2>
        </div>
        {queue ? (
          <span>
            {queue.total} request{queue.total === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {queueLoading ? (
        <div className="curation-panel-state" role="status">
          Loading {STATUS_LABELS[requestStatus].toLocaleLowerCase()} requests…
        </div>
      ) : null}
      {queueError ? (
        <div className="curation-panel-state" role="alert">
          <p>{queueError}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={onReloadQueue}
          >
            Try again
          </button>
        </div>
      ) : null}
      {!queueLoading && !queueError && queue?.items.length === 0 ? (
        <div className="curation-panel-state">
          <strong>No {STATUS_LABELS[requestStatus].toLocaleLowerCase()} requests.</strong>
          <p>Choose another status to review a different part of the queue.</p>
        </div>
      ) : null}
      {queue && queue.items.length > 0 ? (
        <ol
          className="curation-request-list"
          aria-label={`${STATUS_LABELS[requestStatus]} requests`}
        >
          {queue.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={selectedRequestId === item.id}
                onClick={() => onSelectRequest(item.id)}
              >
                <span className={`curation-status curation-status--${item.status}`}>
                  {STATUS_LABELS[item.status]}
                </span>
                <strong>{item.proposed_name}</strong>
                <small>Submitted {formatRequestTime(item.created_at)}</small>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {queue && queue.total_pages > 1 ? (
        <nav className="curation-pagination" aria-label="Ingredient request pages">
          <button
            className="button button--quiet"
            type="button"
            disabled={queueLoading || queue.page <= 1}
            onClick={() => onChangePage(queue.page - 1)}
          >
            ← Previous
          </button>
          <span aria-current="page">
            Page {queue.page} of {queue.total_pages}
          </span>
          <button
            className="button button--quiet"
            type="button"
            disabled={queueLoading || queue.page >= queue.total_pages}
            onClick={() => onChangePage(queue.page + 1)}
          >
            Next →
          </button>
        </nav>
      ) : null}
    </section>
  );
}
