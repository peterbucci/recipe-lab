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
import { SectionLoading } from "./loading-ui";

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
    <nav
      className="staff-filter-strip staff-workspace__filters curation-filters workspace-tab-menu workspace-tab-menu--items-only"
      aria-label="Ingredient request status filters"
    >
      {STATUS_FILTERS.map((filter) => (
        <button
          className="curation-filter workspace-tab-menu__item"
          type="button"
          key={filter.value}
          aria-pressed={requestStatus === filter.value}
          onClick={() => onChangeStatus(filter.value)}
        >
          {filter.label}
          {requestStatus === filter.value && count !== null && count !== undefined ? (
            <span className="workspace-tab-menu__count" aria-hidden="true">
              {count}
            </span>
          ) : null}
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
        <SectionLoading
          className="curation-panel-state"
          count={5}
          label={`Loading ${STATUS_LABELS[requestStatus].toLocaleLowerCase()} requests…`}
          layout="rows"
          refreshing={Boolean(queue)}
        />
      ) : null}
      {queueError ? (
        <div
          className="staff-workspace__notice staff-workspace__notice--error curation-panel-state"
          role="alert"
        >
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
      {queue && queue.total_pages > 1 ? (
        <nav
          className="staff-workspace__pagination curation-pagination"
          aria-label="Ingredient request pages"
        >
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
