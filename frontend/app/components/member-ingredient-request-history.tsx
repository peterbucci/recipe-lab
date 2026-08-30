"use client";

import type { KeyboardEvent } from "react";

import type {
  CatalogIngredientSelection,
  IngredientCatalogRequestStatus,
} from "../../lib/ingredient-catalog-api";
import { MemberIngredientRequestList } from "./member-ingredient-request-list";
import { useMemberIngredientResolutionSelection } from "./use-member-ingredient-resolution-selection";
import { useMemberIngredientRequestHistory } from "./use-member-ingredient-request-history";

interface MemberIngredientRequestHistoryProps {
  contextLabel?: string;
  idPrefix: string;
  onClose?: () => void;
  onSelectResolution?: (selection: CatalogIngredientSelection) => void;
  pageSize?: number;
}

export function MemberIngredientRequestHistory({
  contextLabel,
  idPrefix,
  onClose,
  onSelectResolution,
  pageSize = 20,
}: MemberIngredientRequestHistoryProps) {
  const selectionEnabled = Boolean(contextLabel && onSelectResolution);
  const modeClassName = selectionEnabled
    ? "member-request-history--picker"
    : "member-request-history--standalone";
  const regionLabel = selectionEnabled
    ? `Choose from my ingredient requests for ${contextLabel}`
    : "My ingredient requests";
  const searchLabel = selectionEnabled
    ? `Search my ingredient requests for ${contextLabel}`
    : "Search my ingredient requests";
  const filterLabel = selectionEnabled
    ? `Request status for ${contextLabel}`
    : "Request status";
  const {
    authenticationExpired,
    changePage,
    changeStatusFilter,
    expireAuthentication,
    loadError,
    loading,
    query,
    queryInput,
    refresh,
    requestPage,
    restoreAuthentication,
    statusFilter,
    submitSearch,
    updateQueryInput,
  } = useMemberIngredientRequestHistory({
    pageSize,
    selectionEnabled,
  });
  const { clearSelectionError, selectResolution, selectingRequestId, selectionError } =
    useMemberIngredientResolutionSelection({
      onAuthenticationExpired: expireAuthentication,
      onAuthenticationRestored: restoreAuthentication,
      onSelectResolution,
      selectionEnabled,
    });

  function changeHistoryStatus(status: IngredientCatalogRequestStatus | "") {
    clearSelectionError();
    changeStatusFilter(status);
  }

  function submitHistorySearch() {
    clearSelectionError();
    submitSearch();
  }

  function changeHistoryPage(page: number) {
    clearSelectionError();
    changePage(page);
  }

  function refreshHistory() {
    clearSelectionError();
    refresh();
  }

  return (
    <section
      className={`member-request-history ${modeClassName}`}
      aria-label={regionLabel}
      aria-busy={loading}
    >
      <header className="member-request-history__header">
        <div>
          {selectionEnabled ? <h3>{regionLabel}</h3> : <h2>Request history</h2>}
          <p>
            Track what happened to your requests. Only a curator-approved catalog resolution can
            be chosen for a recipe.
          </p>
        </div>
        {onClose ? (
          <button
            className="button button--quiet"
            type="button"
            disabled={selectingRequestId !== null}
            onClick={onClose}
          >
            Close my requests
          </button>
        ) : null}
      </header>

      <div className="member-request-history__controls">
        <div className="member-request-history__filter">
          <label htmlFor={`${idPrefix}-status-filter`}>{filterLabel}</label>
          <select
            id={`${idPrefix}-status-filter`}
            value={statusFilter}
            onChange={(event) =>
              changeHistoryStatus(event.target.value as IngredientCatalogRequestStatus | "")
            }
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="duplicate">Duplicate</option>
          </select>
        </div>
        <div className="member-request-history__search" role="search" aria-label={searchLabel}>
          <label htmlFor={`${idPrefix}-request-search`}>{searchLabel}</label>
          <div>
            <input
              id={`${idPrefix}-request-search`}
              type="search"
              maxLength={100}
              autoComplete="off"
              value={queryInput}
              onChange={(event) => updateQueryInput(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitHistorySearch();
                }
              }}
            />
            <button
              className="button button--secondary"
              type="button"
              onClick={submitHistorySearch}
            >
              Search requests
            </button>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="member-request-history__error" role="alert">
          <p>{loadError}</p>
          <button className="button button--secondary" type="button" onClick={refreshHistory}>
            Try again
          </button>
        </div>
      ) : null}

      {selectionError ? (
        <p className="member-request-history__selection-error" role="alert">
          {selectionError}
        </p>
      ) : null}

      {authenticationExpired ? (
        <div className="member-request-history__auth-recovery">
          <a
            className="button button--secondary"
            href="/sign-in?return_to=%2Frecipes"
            target="_blank"
            rel="noreferrer"
          >
            Sign in in a new tab
          </a>
          <p>
            {selectionEnabled
              ? "Keep this recipe tab open. After signing in, return here and retry without losing your draft."
              : "After signing in, return to this tab and try loading your requests again."}
          </p>
        </div>
      ) : null}

      {loading && requestPage === null ? (
        <div className="member-request-history__state" role="status" aria-live="polite">
          Loading your ingredient requests…
        </div>
      ) : null}

      {!loading && !loadError && requestPage?.items.length === 0 ? (
        <div className="member-request-history__state">
          <h3>No matching requests</h3>
          <p>
            {query || statusFilter
              ? "Try a different search or status filter."
              : "Requests you submit from an ingredient picker will appear here."}
          </p>
        </div>
      ) : null}

      {requestPage && requestPage.items.length > 0 ? (
        <MemberIngredientRequestList
          contextLabel={contextLabel}
          loading={loading}
          regionLabel={regionLabel}
          requestPage={requestPage}
          selectingRequestId={selectingRequestId}
          selectionEnabled={selectionEnabled}
          onChangePage={changeHistoryPage}
          onSelectResolution={selectResolution}
        />
      ) : null}

      <button
        className="button button--quiet member-request-history__refresh"
        type="button"
        onClick={refreshHistory}
      >
        Refresh my requests
      </button>
    </section>
  );
}
