"use client";

import { Search } from "lucide-react";

import type { IngredientCatalogRequestStatus } from "../ingredient-model";
import { MemberIngredientRequestList } from "./member-ingredient-request-list";
import { useMemberIngredientRequestHistory } from "./use-member-ingredient-request-history";
import { WorkspaceEmptyState } from "../../../shared/ui/workspace-empty-state";
import { WorkspacePanelHeader } from "../../../shared/ui/workspace-panel-header";
import {
  WorkspaceErrorState,
  WorkspaceLoadingState,
} from "../../../shared/ui/workspace-state";
import {
  WorkspaceTabButton,
  WorkspaceTabItems,
  WorkspaceTabMenu,
} from "../../../shared/ui/workspace-tab-menu";

interface MemberIngredientRequestHistoryProps {
  idPrefix: string;
  onRequestIngredient?: () => void;
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
  idPrefix,
  onRequestIngredient,
  pageSize = 20,
}: MemberIngredientRequestHistoryProps) {
  const {
    authenticationExpired,
    changePage,
    changeStatusFilter,
    clearSearch,
    loadError,
    loading,
    query,
    queryInput,
    refresh,
    requestPage,
    statusFilter,
    submitSearch,
    updateQueryInput,
  } = useMemberIngredientRequestHistory({ pageSize });
  const activeStandaloneTab =
    STANDALONE_STATUS_TABS.find((tab) => tab.value === statusFilter) ??
    STANDALONE_STATUS_TABS[0]!;

  const standaloneEmptyAction = query ? (
    <button className="button button--primary" type="button" onClick={clearSearch}>
      Clear search
    </button>
  ) : statusFilter ? (
    <button
      className="button button--primary"
      type="button"
      onClick={() => changeStatusFilter("")}
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
      className="member-request-history member-request-history--standalone workspace-panel-shell"
      aria-label="My ingredient requests"
      aria-busy={loading}
    >
      <WorkspaceTabMenu
        as="form"
        className="member-request-history__toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <WorkspaceTabItems
          className="member-request-history__status-tabs"
          aria-label="Ingredient request status"
          role="group"
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
              onClick={() => changeStatusFilter(tab.value)}
            >
              {tab.label}
            </WorkspaceTabButton>
          ))}
        </WorkspaceTabItems>
        <div
          className="member-request-history__search member-request-history__search--compact workspace-tab-menu__search"
          role="search"
          aria-label="Search my ingredient requests"
        >
          <label className="visually-hidden" htmlFor={`${idPrefix}-request-search`}>
            Search my ingredient requests
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

      {loadError ? (
        <WorkspaceErrorState
          action={
            <button className="button button--secondary" type="button" onClick={refresh}>
              Try again
            </button>
          }
          className="member-request-history__error"
          message={loadError}
        />
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
          <p>After signing in, return to this tab and try loading your requests again.</p>
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
      ) : null}

      {requestPage && requestPage.items.length > 0 ? (
        <MemberIngredientRequestList
          loading={loading}
          requestPage={requestPage}
          onChangePage={changePage}
        />
      ) : null}

      <button
        className="button button--quiet member-request-history__refresh"
        type="button"
        onClick={refresh}
      >
        Refresh my requests
      </button>
    </section>
  );
}
