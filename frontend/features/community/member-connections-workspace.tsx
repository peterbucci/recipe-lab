"use client";

import { BookOpen, Clock3 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { relativeTimeLabel } from "../../shared/time/relative-time";
import { SectionLoading } from "../../shared/ui/loading-ui";
import { PaginationOutOfRange } from "../../shared/ui/pagination-out-of-range";
import { WorkspaceEmptyState } from "../../shared/ui/workspace-empty-state";
import { WorkspacePanelHeader } from "../../shared/ui/workspace-panel-header";
import { WorkspacePagination } from "../../shared/ui/workspace-pagination";
import {
  WorkspaceTabCount,
  WorkspaceTabMenu,
} from "../../shared/ui/workspace-tab-menu";
import {
  fetchMyFollowers,
  fetchMyFollowing,
  MemberFollowApiError,
  type MemberFollower,
  type MemberFollowing,
  type MyFollowersPage,
  type MyFollowingPage,
} from "./member-follow-api";
import {
  connectionsHref,
  MEMBER_CONNECTION_VIEWS,
  type MemberConnectionsView,
} from "./member-connections-route";

const CONNECTION_PAGE_SIZE = 20;

interface MemberConnectionsWorkspaceProps {
  pageNumber: number;
  userId: string;
  view: MemberConnectionsView;
}

interface ViewCopy {
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  errorFallback: string;
  heading: string;
  listLabel: string;
  loadingLabel: string;
  paginationLabel: string;
  resultName: string;
  retryLabel: string;
  staleDescription: (totalPages: number) => string;
  staleTitle: string;
  updatingLabel: string;
}

const VIEW_COPY: Record<MemberConnectionsView, ViewCopy> = {
  followers: {
    description: "Members who follow your public recipe work.",
    emptyDescription:
      "Share your cook profile or publish recipes to help people find your work.",
    emptyTitle: "You do not have any followers yet.",
    errorFallback: "Recipe Lab could not load your followers. Please try again.",
    heading: "Your followers",
    listLabel: "Your followers",
    loadingLabel: "Loading your followers…",
    paginationLabel: "Follower pages",
    resultName: "follower",
    retryLabel: "Retry followers",
    staleDescription: (totalPages) =>
      `Your follower list currently has ${totalPages} pages.`,
    staleTitle: "That page is beyond your current followers.",
    updatingLabel: "Updating your followers…",
  },
  following: {
    description: "Cooks whose public recipe work you follow.",
    emptyDescription:
      "Follow a cook from their public profile to keep up with their recipe work.",
    emptyTitle: "You are not following any cooks yet.",
    errorFallback:
      "Recipe Lab could not load the cooks you follow. Please try again.",
    heading: "Cooks you follow",
    listLabel: "Cooks you follow",
    loadingLabel: "Loading the cooks you follow…",
    paginationLabel: "Following pages",
    resultName: "cook",
    retryLabel: "Retry following",
    staleDescription: (totalPages) =>
      `Your following list currently has ${totalPages} pages.`,
    staleTitle: "That page is beyond the cooks you follow.",
    updatingLabel: "Updating the cooks you follow…",
  },
};

type ConnectionsPage = MyFollowersPage | MyFollowingPage;
type ConnectionItem = MemberFollower | MemberFollowing;

function initialLabel(displayName: string): string {
  return displayName.trim().charAt(0).toLocaleUpperCase() || "?";
}

function viewLabel(view: MemberConnectionsView): string {
  return view.slice(0, 1).toUpperCase() + view.slice(1);
}

function connectionFor(item: ConnectionItem) {
  return "follower" in item ? item.follower : item.cook;
}

function pageSummary(
  page: ConnectionsPage,
  resultName: string,
): string {
  const first = (page.page - 1) * page.page_size + 1;
  const last = first + page.items.length - 1;
  const visibleRange = first === last ? `${first}` : `${first}–${last}`;
  return `Showing ${visibleRange} of ${page.total} ${resultName}${page.total === 1 ? "" : "s"}`;
}

function ConnectionsPagination({
  currentPage,
  loading,
  totalPages,
  view,
}: {
  currentPage: number;
  loading: boolean;
  totalPages: number;
  view: MemberConnectionsView;
}) {
  return (
    <WorkspacePagination
      className="member-connections-page__pagination"
      currentPage={currentPage}
      label={VIEW_COPY[view].paginationLabel}
      loading={loading}
      totalPages={totalPages}
      renderControl={({ disabled, label, page }) =>
        disabled ? (
          <span className="button button--disabled" aria-disabled="true">
            {label}
          </span>
        ) : (
          <Link
            className="button button--secondary"
            href={connectionsHref(view, page)}
          >
            {label}
          </Link>
        )
      }
    />
  );
}

export function MemberConnectionsWorkspace({
  pageNumber,
  userId,
  view,
}: MemberConnectionsWorkspaceProps) {
  const copy = VIEW_COPY[view];
  const [retryCount, setRetryCount] = useState(0);
  const [page, setPage] = useState<ConnectionsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beyondLastPage = Boolean(
    page && page.total > 0 && page.items.length === 0,
  );

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (signal.aborted) return;
      setLoading(true);
      setError("");
      try {
        const result = await (view === "followers"
          ? fetchMyFollowers({
              page: pageNumber,
              pageSize: CONNECTION_PAGE_SIZE,
              signal,
            })
          : fetchMyFollowing({
              page: pageNumber,
              pageSize: CONNECTION_PAGE_SIZE,
              signal,
            }));
        if (!signal.aborted) setPage(result);
      } catch (reason) {
        if (signal.aborted) return;
        setError(
          reason instanceof MemberFollowApiError
            ? reason.message
            : copy.errorFallback,
        );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [copy.errorFallback, pageNumber, view],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load, retryCount, userId]);

  const headingId = `${view}-connections-heading`;
  const activeTotal = page && !error && !beyondLastPage ? page.total : null;

  return (
    <main
      id="main-content"
      className="page-shell account-workspace-page member-connections-page"
    >
      <header className="page-intro member-connections-page__intro">
        <div>
          <h1>Connections</h1>
          <p>See who follows your recipe work and the cooks you follow.</p>
        </div>
        <Link
          className="button button--secondary member-connections-page__activity"
          href="/account/community-activity"
        >
          <BookOpen aria-hidden="true" />
          Community activity
        </Link>
      </header>

      <section
        className="member-connections-page__frame"
        aria-labelledby={headingId}
      >
        <WorkspaceTabMenu
          as="nav"
          className="member-connections-page__views"
          aria-label="Connection views"
          itemsOnly
        >
          {MEMBER_CONNECTION_VIEWS.map((connectionView) => (
            <Link
              aria-current={connectionView === view ? "page" : undefined}
              className="member-connections-page__view-link workspace-tab-menu__item"
              href={connectionsHref(connectionView)}
              key={connectionView}
            >
              {viewLabel(connectionView)}
              {connectionView === view && activeTotal !== null ? (
                <WorkspaceTabCount>{activeTotal}</WorkspaceTabCount>
              ) : null}
            </Link>
          ))}
        </WorkspaceTabMenu>

        <WorkspacePanelHeader
          description={copy.description}
          headingId={headingId}
          meta={
            activeTotal !== null ? (
              <span aria-live="polite">
                {activeTotal} {copy.resultName}
                {activeTotal === 1 ? "" : "s"}
              </span>
            ) : null
          }
          title={copy.heading}
        />

        <div className="member-connections-page__content">
          {error ? (
            <div className="member-connections-page__state" role="alert">
              <p>{error}</p>
              <button
                className="button button--primary"
                type="button"
                onClick={() => setRetryCount((count) => count + 1)}
              >
                {copy.retryLabel}
              </button>
            </div>
          ) : null}

          {loading && !page ? (
            <SectionLoading
              className="member-connections-page__state"
              count={5}
              label={copy.loadingLabel}
              layout="summary"
            />
          ) : null}

          {loading && page ? (
            <SectionLoading label={copy.updatingLabel} refreshing />
          ) : null}

          {!loading && !error && page?.total === 0 ? (
            <WorkspaceEmptyState
              action={
                <Link className="button button--primary" href="/recipes">
                  Explore recipes
                </Link>
              }
              className="member-connections-page__state"
              description={copy.emptyDescription}
              headingId={`${view}-connections-empty`}
              headingLevel={3}
              title={copy.emptyTitle}
            />
          ) : null}

          {!loading && !error && beyondLastPage && page ? (
            <PaginationOutOfRange
              action={
                <Link
                  className="button button--secondary"
                  href={connectionsHref(view)}
                >
                  Return to the first page
                </Link>
              }
              className="member-connections-page__state"
              description={copy.staleDescription(page.total_pages)}
              headingId={`${view}-connections-out-of-range`}
              headingLevel={3}
              title={copy.staleTitle}
            />
          ) : null}

          {page && !error && !beyondLastPage && page.items.length > 0 ? (
            <>
              <ol
                className="member-connections-page__list"
                aria-label={copy.listLabel}
                aria-busy={loading}
              >
                {page.items.map((item) => {
                  const connection = connectionFor(item);
                  const followed = relativeTimeLabel(item.followed_at);
                  return (
                    <li
                      className="member-connections-page__card"
                      key={connection.id}
                    >
                      <span
                        className="member-connections-page__avatar"
                        aria-hidden="true"
                      >
                        {initialLabel(connection.display_name)}
                      </span>
                      <div className="member-connections-page__copy">
                        <div className="member-connections-page__identity">
                          <strong>{connection.display_name}</strong>
                          {connection.handle ? (
                            <span className="member-connections-page__handle">
                              @{connection.handle}
                            </span>
                          ) : null}
                        </div>
                        <span className="member-connections-page__meta">
                          <Clock3 aria-hidden="true" />
                          <time
                            dateTime={item.followed_at}
                            title={followed?.absoluteLabel}
                          >
                            {view === "followers" ? "Followed you" : "You followed"}{" "}
                            {followed?.relativeLabel ?? "recently"}
                          </time>
                        </span>
                      </div>
                      {connection.handle ? (
                        <Link
                          aria-label={`View ${connection.display_name}’s profile`}
                          className="button button--secondary"
                          href={`/cooks/${encodeURIComponent(connection.handle)}`}
                        >
                          View profile
                        </Link>
                      ) : (
                        <span className="member-connections-page__unavailable">
                          Profile unavailable
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
              <footer className="member-connections-page__list-footer">
                <ConnectionsPagination
                  currentPage={page.page}
                  loading={loading}
                  totalPages={page.total_pages}
                  view={view}
                />
                <span aria-live="polite">
                  {pageSummary(page, copy.resultName)}
                </span>
              </footer>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
