"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  fetchMyCommunityActivity,
  type MyCommunityActivityPage,
} from "../../lib/member-follow-api";
import { useAuthSession } from "./auth-session-provider";
import { CommunityPublicationList } from "./community-publication-list";
import { LoadingButton, SectionLoading } from "./loading-ui";
import { MemberRouteGate } from "./member-route-gate";

const ACTIVITY_PAGE_SIZE = 20;

type CommunityActivityState =
  | { phase: "loading" }
  | {
      data: MyCommunityActivityPage;
      loadMoreFailed: boolean;
      loadingMore: boolean;
      phase: "ready";
    }
  | { phase: "error" };

function CommunityActivityTimelineInner({ userId }: { userId: string }) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<CommunityActivityState>({
    phase: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetchMyCommunityActivity({
      page: 1,
      pageSize: ACTIVITY_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setState({
            data,
            loadMoreFailed: false,
            loadingMore: false,
            phase: "ready",
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: "error" });
      });
    return () => controller.abort();
  }, [reload, userId]);

  const retry = useCallback(() => {
    setState({ phase: "loading" });
    setReload((current) => current + 1);
  }, []);

  const loadMore = useCallback(async () => {
    if (state.phase !== "ready" || state.loadingMore) return;
    const current = state.data;
    setState({ ...state, loadMoreFailed: false, loadingMore: true });
    try {
      const next = await fetchMyCommunityActivity({
        page: current.page + 1,
        pageSize: ACTIVITY_PAGE_SIZE,
      });
      setState({
        data: {
          ...next,
          items: [...current.items, ...next.items],
        },
        loadMoreFailed: false,
        loadingMore: false,
        phase: "ready",
      });
    } catch {
      setState({
        data: current,
        loadMoreFailed: true,
        loadingMore: false,
        phase: "ready",
      });
    }
  }, [state]);

  return (
    <main
      id="main-content"
      className="member-activity-page member-activity-page--timeline community-activity-page"
    >
      <section
        className="member-activity-page__panel"
        aria-labelledby="community-activity-title"
      >
        <header className="member-activity-page__heading">
          <div>
            <h1 id="community-activity-title">Community activity</h1>
            <p>New recipes and versions published by cooks you follow.</p>
          </div>
        </header>

        {state.phase === "loading" ? (
          <section
            className="member-activity-page__shell community-activity-page__shell"
            aria-label="Loading community activity"
          >
            <SectionLoading
              className="member-activity-page__state"
              count={6}
              label="Loading community activity…"
              layout="rows"
            />
          </section>
        ) : state.phase === "error" ? (
          <section
            className="member-activity-page__shell community-activity-page__shell"
            aria-label="Community activity unavailable"
          >
            <div className="member-activity-page__state" role="alert">
              <h2>Community activity is temporarily unavailable</h2>
              <p>Try again to check for new recipes from cooks you follow.</p>
              <button
                className="button button--primary"
                type="button"
                onClick={retry}
              >
                Try again
              </button>
            </div>
          </section>
        ) : state.data.items.length === 0 ? (
          <section
            className="member-activity-page__shell community-activity-page__shell"
            aria-label="Community activity"
          >
            <div className="member-activity-page__state">
              <h2>No community activity yet</h2>
              <p>Follow cooks to see their new recipes and versions here.</p>
              <Link className="button button--primary" href="/recipes">
                Find cooks to follow
              </Link>
            </div>
          </section>
        ) : (
          <section
            className="member-activity-page__shell community-activity-page__shell"
            aria-label="Community activity"
          >
            <CommunityPublicationList items={state.data.items} />
            {state.loadMoreFailed ? (
              <p className="community-activity-page__load-error" role="alert">
                Older activity could not be loaded. Try again.
              </p>
            ) : null}
            {state.data.items.length < state.data.total ? (
              <div className="member-activity-page__load-more community-activity-page__load-more">
                <LoadingButton
                  className="button button--secondary"
                  pending={state.loadingMore}
                  pendingLabel="Loading older activity…"
                  type="button"
                  onClick={() => void loadMore()}
                >
                  Load older activity
                </LoadingButton>
              </div>
            ) : null}
          </section>
        )}
      </section>
    </main>
  );
}

export function CommunityActivityTimeline() {
  const { state } = useAuthSession();
  const userId =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session.user.id
      : null;

  return (
    <MemberRouteGate
      anonymousHeading="Sign in to see your community activity"
      anonymousMessage="Follow cooks and keep up with the recipes and versions they publish."
      eyebrow="Your community"
      returnTo="/account/community-activity"
      title="Community activity"
    >
      {userId ? (
        <CommunityActivityTimelineInner key={userId} userId={userId} />
      ) : null}
    </MemberRouteGate>
  );
}
