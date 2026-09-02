"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  fetchMyCommunityActivity,
  MemberFollowApiError,
  type MyCommunityActivityPage,
} from "../../lib/member-follow-api";
import { useAuthSession } from "./auth-session-provider";
import { CommunityPublicationList } from "./community-publication-list";
import { useHomeLoadIssue } from "./home-load-state";
import { SectionLoading } from "./loading-ui";

const COMMUNITY_FEED_SIZE = 5;

type CommunityFeedState =
  | { phase: "loading" }
  | { data: MyCommunityActivityPage; phase: "ready" }
  | { phase: "error"; reportAsHomeIssue: boolean };

interface StoredCommunityFeedState {
  state: CommunityFeedState;
  userId: string | null;
}

export function HomeCommunityFeed() {
  const { state: sessionState } = useAuthSession();
  const userId =
    sessionState.phase === "ready" &&
    sessionState.session.status === "authenticated"
      ? sessionState.session.user.id
      : null;
  const [reload, setReload] = useState(0);
  const [stored, setStored] = useState<StoredCommunityFeedState>({
    state: { phase: "loading" },
    userId: null,
  });

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    void fetchMyCommunityActivity({
      page: 1,
      pageSize: COMMUNITY_FEED_SIZE,
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setStored({ state: { data, phase: "ready" }, userId });
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setStored({
          state: {
            phase: "error",
            reportAsHomeIssue:
              !(reason instanceof MemberFollowApiError) ||
              (reason.status !== 401 && reason.status !== 403),
          },
          userId,
        });
      });
    return () => controller.abort();
  }, [reload, userId]);

  const retry = useCallback(() => setReload((current) => current + 1), []);
  const feedState: CommunityFeedState =
    userId && stored.userId === userId
      ? stored.state
      : { phase: "loading" };
  useHomeLoadIssue({
    active:
      feedState.phase === "error" && feedState.reportAsHomeIssue,
    id: "community-feed",
    retry,
  });

  let content;
  if (sessionState.phase === "loading") {
    content = (
      <SectionLoading
        className="home-community-feed__loading"
        count={5}
        label="Loading community activity…"
        layout="rows"
      />
    );
  } else if (
    sessionState.phase !== "ready" ||
    sessionState.session.status !== "authenticated"
  ) {
    content = (
      <div className="home-section-state">
        <p>Follow cooks to see their new recipes and versions here.</p>
        <Link href="/sign-in?return_to=%2F">Sign in to build your community</Link>
      </div>
    );
  } else if (feedState.phase === "loading") {
    content = (
      <SectionLoading
        className="home-community-feed__loading"
        count={5}
        label="Loading community activity…"
        layout="rows"
      />
    );
  } else if (feedState.phase === "error") {
    content = (
      <div
        aria-label="Community activity unavailable"
        className="home-section-state home-section-state--unavailable"
      >
        <p>Unavailable</p>
      </div>
    );
  } else if (feedState.data.items.length === 0) {
    content = (
      <div className="home-section-state">
        <p>No updates from cooks you follow yet.</p>
        <Link href="/recipes">Find cooks to follow</Link>
      </div>
    );
  } else {
    content = <CommunityPublicationList items={feedState.data.items} />;
  }

  return (
    <section
      className="home-content-section home-community-feed"
      aria-labelledby="home-community-heading"
    >
      <header className="home-content-section__heading">
        <div>
          <h2
            className="home-content-section__title"
            id="home-community-heading"
          >
            From your community
          </h2>
        </div>
        <Link className="text-link" href="/account/community-activity">
          View all <span aria-hidden="true">→</span>
        </Link>
      </header>
      {content}
    </section>
  );
}
