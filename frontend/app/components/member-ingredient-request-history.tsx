"use client";

import { Search } from "lucide-react";
import type { KeyboardEvent } from "react";

import type {
  CatalogIngredientSelection,
  IngredientCatalogRequestStatus,
} from "../../lib/ingredient-catalog-api";
import { MemberIngredientRequestList } from "./member-ingredient-request-list";
import { useMemberIngredientResolutionSelection } from "./use-member-ingredient-resolution-selection";
import { useMemberIngredientRequestHistory } from "./use-member-ingredient-request-history";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspacePanelHeader } from "./workspace-panel-header";
import {
  WorkspaceErrorState,
  WorkspaceLoadingState,
} from "./workspace-state";
import {
  WorkspaceTabButton,
  WorkspaceTabItems,
  WorkspaceTabMenu,
} from "./workspace-tab-menu";

interface MemberIngredientRequestHistoryProps {
  contextLabel?: string;
  idPrefix: string;
  onClose?: () => void;
  onRequestIngredient?: () => void;
  onSelectResolution?: (selection: CatalogIngredientSelection) => void;
  pageSize?: number;
}

const STANDALONE_STATUS_TABS: Array<{
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  label: string;
  title: string;
  value: IngredientCatalogRequestStatus | "";
}> = [
  {
    description: "Review every ingredient request you’ve submitted and its latest status.",
    emptyDescription: "Request an ingredient and its review status will appear here.",
    emptyTitle: "You have no ingredient requests yet.",
    label: "All",
    title: "All requests",
    value: "",
  },
  {
    description: "Requests waiting for curator review.",
    emptyDescription: "New ingredient requests will appear here while they wait for curator review.",
    emptyTitle: "You have no pending requests.",
    label: "Pending",
    title: "Pending requests",
    value: "pending",
  },
  {
    description: "Requests that a curator added to the catalog.",
    emptyDescription: "Requests will appear here after a curator adds them to the catalog.",
    emptyTitle: "You have no approved requests.",
    label: "Approved",
    title: "Approved requests",
    value: "approved",
  },
  {
    description: "Requests a curator matched to ingredients already in the catalog.",
    emptyDescription: "Requests will appear here after a curator matches them to an existing ingredient.",
    emptyTitle: "You have no matched requests.",
    label: "Matched",
    title: "Matched requests",
    value: "duplicate",
  },
  {
    description: "Requests that were not added to the catalog.",
    emptyDescription: "Requests will appear here if a curator decides not to add them.",
    emptyTitle: "You have no rejected requests.",
    label: "Rejected",
    title: "Rejected requests",
    value: "rejected",
  },
];

export function MemberIngredientRequestHistory({
  contextLabel,
  idPrefix,
  onClose,
  onRequestIngredient,
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
    clearSearch,
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
  const activeStandaloneTab =
    STANDALONE_STATUS_TABS.find((tab) => tab.value === statusFilter) ??
    STANDALONE_STATUS_TABS[0]!;

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

  function clearHistorySearch() {
    clearSelectionError();
    clearSearch();
  }

  const standaloneEmptyAction = query ? (
    <button className="button button--primary" type="button" onClick={clearHistorySearch}>
      Clear search
    </button>
  ) : statusFilter ? (
    <button
      className="button button--primary"
      type="button"
      onClick={() => changeHistoryStatus("")}
    >
      View all requests
    </button>
  ) : onRequestIngredient ? (
    <button className="button button--primary" type="button" onClick={onRequestIngredient}>
      Request an ingredient
    </button>
  ) : null;

  return (
    <section
      className={`member-request-history ${modeClassName}`}
      aria-label={regionLabel}
      aria-busy={loading}
    >
      {selectionEnabled || onClose ? (
        <header className="member-request-history__header">
          <div>
            <h3>{regionLabel}</h3>
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
      ) : null}

      {selectionEnabled ? (
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
      ) : (
        <>
          <WorkspaceTabMenu
            as="form"
            className="member-request-history__toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              submitHistorySearch();
            }}
          >
            <WorkspaceTabItems
              as="nav"
              className="member-request-history__status-tabs"
              aria-label="Ingredient request status"
            >
              {STANDALONE_STATUS_TABS.map((tab) => (
                <WorkspaceTabButton
                  key={tab.value || "all"}
                  className="member-request-history__status-tab"
                  type="button"
                  active={statusFilter === tab.value}
                  count={
                    statusFilter === tab.value && !loading && requestPage
                      ? requestPage.total
                      : null
                  }
                  onClick={() => changeHistoryStatus(tab.value)}
                >
                  {tab.label}
                </WorkspaceTabButton>
              ))}
            </WorkspaceTabItems>
            <div
              className="member-request-history__search member-request-history__search--compact workspace-tab-menu__search"
              role="search"
              aria-label={searchLabel}
            >
              <label className="visually-hidden" htmlFor={`${idPrefix}-request-search`}>
                {searchLabel}
              </label>
              <Search aria-hidden="true" />
              <input
                id={`${idPrefix}-request-search`}
                type="search"
                maxLength={100}
                autoComplete="off"
                placeholder="Search requests…"
                value={queryInput}
                onChange={(event) => updateQueryInput(event.target.value)}
              />
            </div>
          </WorkspaceTabMenu>
          <WorkspacePanelHeader
            description={activeStandaloneTab.description}
            headingId={`${idPrefix}-selected-status-heading`}
            meta={
              !loading && requestPage ? (
                <span aria-live="polite">
                  {requestPage.total} request{requestPage.total === 1 ? "" : "s"}
                </span>
              ) : null
            }
            title={activeStandaloneTab.title}
          />
        </>
      )}

      {loadError ? (
        <WorkspaceErrorState
          action={<button className="button button--secondary" type="button" onClick={refreshHistory}>
            Try again
          </button>}
          className="member-request-history__error"
          message={loadError}
        />
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
        <WorkspaceLoadingState
          className="member-request-history__state"
          count={4}
          label="Loading your ingredient requests…"
          layout="rows"
        />
      ) : null}

      {loading && requestPage !== null ? (
        <WorkspaceLoadingState
          label="Updating your ingredient requests…"
          refreshing
        />
      ) : null}

      {!loading && !loadError && requestPage?.items.length === 0 ? (
        selectionEnabled ? (
          <div className="member-request-history__state">
            <h3>No matching requests</h3>
            <p>Try a different search or status filter.</p>
          </div>
        ) : (
          <WorkspaceEmptyState
            action={standaloneEmptyAction}
            description={
              query
                ? "Try a different search term or clear the search."
                : activeStandaloneTab.emptyDescription
            }
            eyebrow={query ? "No matches" : undefined}
            headingId={`${idPrefix}-empty-requests`}
            headingLevel={3}
            title={query ? "No requests match your search." : activeStandaloneTab.emptyTitle}
          />
        )
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
