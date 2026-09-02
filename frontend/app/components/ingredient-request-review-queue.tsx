"use client";

import { useState } from "react";

import type {
  IngredientCatalogRequestStatus,
  IngredientCatalogReviewItem,
  IngredientCatalogReviewPage,
} from "../../lib/ingredient-catalog-api";
import {
  formatRequestDate,
  formatRequestTime,
  STATUS_FILTERS,
  STATUS_LABELS,
} from "./ingredient-request-review-model";
import { WorkspacePagination } from "./workspace-pagination";
import {
  WorkspaceErrorState,
  WorkspaceLoadingState,
} from "./workspace-state";
import {
  WorkspaceTabButton,
  WorkspaceTabMenu,
} from "./workspace-tab-menu";

interface IngredientRequestStatusFiltersProps {
  count?: number | null;
  requestStatus: IngredientCatalogRequestStatus;
  onChangeStatus: (status: IngredientCatalogRequestStatus) => void;
}

export function IngredientRequestStatusFilters({
  count,
  requestStatus,
  onChangeStatus,
}: IngredientRequestStatusFiltersProps) {
  return (
    <WorkspaceTabMenu
      as="nav"
      className="staff-filter-strip staff-workspace__filters curation-filters"
      aria-label="Ingredient request status filters"
      itemsOnly
    >
      {STATUS_FILTERS.map((filter) => (
        <WorkspaceTabButton
          className="curation-filter"
          type="button"
          key={filter.value}
          active={requestStatus === filter.value}
          count={
            requestStatus === filter.value && count !== null && count !== undefined
              ? count
              : null
          }
          onClick={() => onChangeStatus(filter.value)}
        >
          {filter.label}
        </WorkspaceTabButton>
      ))}
    </WorkspaceTabMenu>
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

function matchingQueueItems(
  items: IngredientCatalogReviewItem[],
  query: string,
): IngredientCatalogReviewItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return items;
  }
  return items.filter((item) =>
    `${item.proposed_name} ${item.context ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
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
  const [query, setQuery] = useState("");
  const visibleItems = queue ? matchingQueueItems(queue.items, query) : [];

  function changeQuery(nextQuery: string) {
    setQuery(nextQuery);
    if (!queue) {
      return;
    }
    const nextItems = matchingQueueItems(queue.items, nextQuery);
    if (!nextItems.some((item) => item.id === selectedRequestId)) {
      onSelectRequest(nextItems[0]?.id ?? null);
    }
  }

  return (
    <section
      className="staff-panel-surface staff-sticky-queue staff-workspace__queue curation-queue"
      aria-labelledby="curation-queue-heading"
      aria-busy={queueLoading}
    >
      <div className="curation-panel-heading">
        <h2 id="curation-queue-heading">
          {STATUS_LABELS[requestStatus]} requests
        </h2>
        {queue ? (
          <span className="curation-panel-heading__count">
            {queue.total} request{queue.total === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <div className="curation-queue-search" role="search">
        <label className="visually-hidden" htmlFor="curation-queue-search">
          Search this queue
        </label>
        <input
          id="curation-queue-search"
          type="search"
          autoComplete="off"
          placeholder="Search this queue…"
          value={query}
          disabled={queueLoading && !queue}
          onChange={(event) => changeQuery(event.target.value)}
        />
      </div>

      {queueLoading ? (
        <WorkspaceLoadingState
          className="curation-panel-state"
          count={5}
          label={`Loading ${STATUS_LABELS[requestStatus].toLocaleLowerCase()} requests…`}
          layout="rows"
          refreshing={Boolean(queue)}
        />
      ) : null}
      {queueError ? (
        <WorkspaceErrorState
          action={<button
            className="button button--secondary"
            type="button"
            onClick={onReloadQueue}
          >
            Try again
          </button>}
          className="staff-workspace__notice staff-workspace__notice--error curation-panel-state"
          message={queueError}
        />
      ) : null}
      {!queueLoading && !queueError && queue?.items.length === 0 ? (
        <p className="curation-queue__empty">
          No {STATUS_LABELS[requestStatus].toLocaleLowerCase()} requests.
        </p>
      ) : null}
      {!queueLoading &&
      !queueError &&
      queue &&
      queue.items.length > 0 &&
      visibleItems.length === 0 ? (
        <p className="curation-queue__empty">No requests match this search.</p>
      ) : null}
      {visibleItems.length > 0 ? (
        <ol
          className="staff-workspace__queue-list curation-request-list"
          aria-label={`${STATUS_LABELS[requestStatus]} requests`}
        >
          {visibleItems.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={selectedRequestId === item.id}
                onClick={() => onSelectRequest(item.id)}
              >
                <span className="curation-request-list__top">
                  <strong>{item.proposed_name}</strong>
                  <span className={`curation-status curation-status--${item.status}`}>
                    {STATUS_LABELS[item.status]}
                  </span>
                </span>
                <span className="curation-request-list__meta">
                  <time
                    dateTime={item.created_at}
                    aria-label={`Submitted ${formatRequestTime(item.created_at)}`}
                  >
                    {formatRequestDate(item.created_at)}
                  </time>
                </span>
                <span className="curation-request-list__context">
                  {item.context?.trim() || "No context provided."}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {queue ? (
        <WorkspacePagination
          buttonClassName="button button--quiet"
          className="staff-workspace__pagination curation-pagination"
          currentPage={queue.page}
          label="Ingredient request pages"
          loading={queueLoading}
          onPageChange={onChangePage}
          totalPages={queue.total_pages}
        />
      ) : null}
    </section>
  );
}
