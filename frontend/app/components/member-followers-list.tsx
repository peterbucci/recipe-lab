"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  fetchMyFollowers,
  MemberFollowApiError,
  type MyFollowersPage,
} from "../../lib/member-follow-api";
import { relativeTimeLabel } from "../../lib/relative-time";
import { useAuthSession } from "./auth-session-provider";
import { SectionLoading } from "./loading-ui";
import { MemberRouteGate } from "./member-route-gate";
import { PrivateLibraryPagination } from "./private-library-pagination";

const FOLLOWER_PAGE_SIZE = 20;
const RETURN_TO = "/account/followers";

function initialLabel(displayName: string): string {
  return displayName.trim().charAt(0).toLocaleUpperCase() || "?";
}

function MemberFollowersListInner({ userId }: { userId: string }) {
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<MyFollowersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beyondLastPage = Boolean(page && page.total > 0 && page.items.length === 0);

  const load = useCallback(async (requestedPage: number, signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchMyFollowers({
        page: requestedPage,
        pageSize: FOLLOWER_PAGE_SIZE,
        signal,
      });
      if (signal?.aborted) return;
      setPage(result);
      setPageNumber(result.page);
    } catch (reason) {
      if (signal?.aborted) return;
      setError(
        reason instanceof MemberFollowApiError
          ? reason.message
          : "Recipe Lab could not load your followers. Please try again.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMyFollowers({
      page: pageNumber,
      pageSize: FOLLOWER_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPage(result);
        setPageNumber(result.page);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof MemberFollowApiError
            ? reason.message
            : "Recipe Lab could not load your followers. Please try again.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pageNumber, userId]);

  function changePage(nextPage: number) {
    setLoading(true);
    setError("");
    setPageNumber(nextPage);
  }

  return (
    <main id="main-content" className="member-activity-page account-workspace-page">
      <section
        className="member-activity-page__panel"
        aria-labelledby="member-followers-title"
      >
        <header className="member-activity-page__heading">
          <div>
            <p className="eyebrow">Your community</p>
            <h1 id="member-followers-title">Followers</h1>
            <p>See the Recipe Lab members who follow your public recipe work.</p>
          </div>
          <Link className="text-link" href="/">
            Back home
          </Link>
        </header>

        <p className="member-library__privacy">
          This account list is private. Public cook pages only show the follower total.
        </p>

        {error ? (
          <div className="member-activity-page__state" role="alert">
            <p>{error}</p>
            <button
              className="button button--primary"
              type="button"
              onClick={() => void load(pageNumber)}
            >
              Retry followers
            </button>
          </div>
        ) : null}

        {loading && !page ? (
          <SectionLoading
            className="member-activity-page__state"
            count={5}
            label="Loading your followers…"
            layout="summary"
          />
        ) : null}

        {loading && page ? (
          <SectionLoading
            label="Updating your followers…"
            refreshing
          />
        ) : null}

        {!loading && !error && page?.total === 0 ? (
          <div className="member-activity-page__state">
            <p>You do not have any followers yet.</p>
            <Link className="button button--primary" href="/recipes">
              Explore recipes
            </Link>
          </div>
        ) : null}

        {!loading && !error && beyondLastPage && page ? (
          <div className="member-activity-page__state">
            <p>That page is beyond your current followers.</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => changePage(1)}
            >
              Return to the first page
            </button>
          </div>
        ) : null}

        {page && !error && !beyondLastPage && page.items.length > 0 ? (
          <>
            <p className="result-count" aria-live="polite">
              {page.total} {page.total === 1 ? "follower" : "followers"}
            </p>
            <ol
              className="member-activity-page__list"
              aria-label="Your followers"
              aria-busy={loading}
            >
              {page.items.map(({ follower, followed_at: followedAt }) => {
                const followed = relativeTimeLabel(followedAt);
                return (
                  <li key={follower.id}>
                    <span className="member-activity-page__icon" aria-hidden="true">
                      {initialLabel(follower.display_name)}
                    </span>
                    <div>
                      <strong>{follower.display_name}</strong>
                      {follower.handle ? <span>@{follower.handle}</span> : null}
                      <time dateTime={followedAt} title={followed?.absoluteLabel}>
                        Followed you {followed?.relativeLabel ?? "recently"}
                      </time>
                    </div>
                    {follower.handle ? (
                      <Link
                        aria-label={`View ${follower.display_name}’s profile`}
                        className="button button--secondary"
                        href={`/cooks/${encodeURIComponent(follower.handle)}`}
                      >
                        View profile
                      </Link>
                    ) : (
                      <span>Profile unavailable</span>
                    )}
                  </li>
                );
              })}
            </ol>
            <PrivateLibraryPagination
              currentPage={page.page}
              label="Follower pages"
              loading={loading}
              onPageChange={changePage}
              totalPages={page.total_pages}
            />
          </>
        ) : null}
      </section>
    </main>
  );
}

export function MemberFollowersList() {
  const { state } = useAuthSession();
  const userId =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session.user.id
      : null;

  return (
    <MemberRouteGate
      eyebrow="Your community"
      returnTo={RETURN_TO}
      title="Followers"
    >
      {userId ? <MemberFollowersListInner key={userId} userId={userId} /> : null}
    </MemberRouteGate>
  );
}
