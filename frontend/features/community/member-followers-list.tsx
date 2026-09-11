"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen, Clock3, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  fetchMyFollowers,
  MemberFollowApiError,
  type MyFollowersPage,
} from "./member-follow-api";
import { relativeTimeLabel } from "../../shared/time/relative-time";
import { SectionLoading } from "../../shared/ui/loading-ui";
import { PaginationOutOfRange } from "../../shared/ui/pagination-out-of-range";
import { WorkspacePagination } from "../../shared/ui/workspace-pagination";

const FOLLOWER_PAGE_SIZE = 20;

function initialLabel(displayName: string): string {
  return displayName.trim().charAt(0).toLocaleUpperCase() || "?";
}

function followerSummary(page: MyFollowersPage): string {
  const first = (page.page - 1) * page.page_size + 1;
  const last = first + page.items.length - 1;
  const visibleRange = first === last ? `${first}` : `${first}–${last}`;
  return `Showing ${visibleRange} of ${page.total} ${page.total === 1 ? "follower" : "followers"}`;
}

export function MemberFollowersList({ userId }: { userId: string }) {
  const [pageNumber, setPageNumber] = useState(1);
  const [retryCount, setRetryCount] = useState(0);
  const [page, setPage] = useState<MyFollowersPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beyondLastPage = Boolean(page && page.total > 0 && page.items.length === 0);

  const load = useCallback(async (requestedPage: number, signal: AbortSignal) => {
    if (signal.aborted) return;
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
    void Promise.resolve().then(() => load(pageNumber, controller.signal));
    return () => controller.abort();
  }, [load, pageNumber, retryCount, userId]);

  function changePage(nextPage: number) {
    setLoading(true);
    setError("");
    setPageNumber(nextPage);
  }

  return (
    <main id="main-content" className="member-followers-page">
      <div className="member-followers-page__inner">
        <Link className="member-followers-page__back" href="/">
          <ArrowLeft aria-hidden="true" />
          Back home
        </Link>

        <header className="member-followers-page__hero">
          <div>
            <p className="eyebrow">Your community</p>
            <h1 id="member-followers-title">Followers</h1>
            <p className="member-followers-page__lede">
              See the Recipe Lab members who follow your public recipe work.
            </p>
          </div>
          <Link
            className="button button--secondary member-followers-page__activity"
            href="/account/community-activity"
          >
            <BookOpen aria-hidden="true" />
            Community activity
          </Link>
        </header>

        <section
          className="member-followers-page__shell"
          aria-labelledby="followers-list-title"
        >
          <aside className="member-followers-page__privacy" aria-label="Follower privacy">
            <span className="member-followers-page__privacy-icon" aria-hidden="true">
              <ShieldCheck />
            </span>
            <div>
              <strong>Only you can see this list</strong>
              <p>
                Public cook pages show your follower total, but never reveal who follows
                you.
              </p>
            </div>
          </aside>

          <div className="member-followers-page__list-section">
            <header className="member-followers-page__list-heading">
              <h2 id="followers-list-title">Your followers</h2>
              {page && !error ? (
                <span
                  aria-label={`${page.total} ${page.total === 1 ? "follower" : "followers"}`}
                  className="member-followers-page__count"
                >
                  {page.total}
                </span>
              ) : null}
            </header>

            {error ? (
              <div className="member-followers-page__state" role="alert">
                <p>{error}</p>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => setRetryCount((count) => count + 1)}
                >
                  Retry followers
                </button>
              </div>
            ) : null}

            {loading && !page ? (
              <SectionLoading
                className="member-followers-page__state"
                count={5}
                label="Loading your followers…"
                layout="summary"
              />
            ) : null}

            {loading && page ? (
              <SectionLoading label="Updating your followers…" refreshing />
            ) : null}

            {!loading && !error && page?.total === 0 ? (
              <div className="member-followers-page__state">
                <p>You do not have any followers yet.</p>
                <Link className="button button--primary" href="/recipes">
                  Explore recipes
                </Link>
              </div>
            ) : null}

            {!loading && !error && beyondLastPage && page ? (
              <PaginationOutOfRange
                action={
                  <button
                    className="button button--secondary"
                    type="button"
                    onClick={() => changePage(1)}
                  >
                    Return to the first page
                  </button>
                }
                className="member-followers-page__state"
                description={`Your follower list currently has ${page.total_pages} pages.`}
                headingId="followers-page-out-of-range"
                title="That page is beyond your current followers."
              />
            ) : null}

            {page && !error && !beyondLastPage && page.items.length > 0 ? (
              <>
                <ol
                  className="member-followers-page__list"
                  aria-label="Your followers"
                  aria-busy={loading}
                >
                  {page.items.map(({ follower, followed_at: followedAt }) => {
                    const followed = relativeTimeLabel(followedAt);
                    return (
                      <li className="member-followers-page__card" key={follower.id}>
                        <span
                          className="member-followers-page__avatar"
                          aria-hidden="true"
                        >
                          {initialLabel(follower.display_name)}
                        </span>
                        <div className="member-followers-page__copy">
                          <div className="member-followers-page__identity">
                            <strong>{follower.display_name}</strong>
                            {follower.handle ? (
                              <span className="member-followers-page__handle">
                                @{follower.handle}
                              </span>
                            ) : null}
                          </div>
                          <span className="member-followers-page__meta">
                            <Clock3 aria-hidden="true" />
                            <time dateTime={followedAt} title={followed?.absoluteLabel}>
                              Followed you {followed?.relativeLabel ?? "recently"}
                            </time>
                          </span>
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
                          <span className="member-followers-page__unavailable">
                            Profile unavailable
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
                <footer className="member-followers-page__list-footer">
                  <WorkspacePagination
                    className="member-followers-page__pagination"
                    currentPage={page.page}
                    label="Follower pages"
                    loading={loading}
                    onPageChange={changePage}
                    totalPages={page.total_pages}
                  />
                  <span aria-live="polite">{followerSummary(page)}</span>
                </footer>
              </>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

