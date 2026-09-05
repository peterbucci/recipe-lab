"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuthSession } from "./auth-session-provider";
import { HomeLoadNotice, HomeLoadStateProvider } from "./home-load-state";
import { HomeCommunityFeed } from "./home-community-feed";
import { SectionLoading } from "./loading-ui";
import { MemberHomeSummary } from "./member-home-summary";

interface HomeDashboardLayoutProps {
  children: ReactNode;
}

export function HomeDashboardLayout({ children }: HomeDashboardLayoutProps) {
  const router = useRouter();
  const { state } = useAuthSession();
  const authenticatedSession =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session
      : null;
  const checkingSession = state.phase === "loading";
  const anonymousSession =
    state.phase === "ready" && state.session.status === "anonymous";
  const showSummaryColumn = authenticatedSession !== null || checkingSession;

  useEffect(() => {
    if (anonymousSession) {
      router.replace("/recipes");
    }
  }, [anonymousSession, router]);

  if (anonymousSession) {
    return (
      <HomeLoadStateProvider>
        <div className="home-public-discovery home-public-discovery--loading">
          <SectionLoading
            count={6}
            label="Opening all recipes…"
            layout="cards"
          />
        </div>
      </HomeLoadStateProvider>
    );
  }

  return (
    <HomeLoadStateProvider>
      <div
        className={
          showSummaryColumn
            ? "home-member-layout home-member-layout--authenticated"
            : "home-member-layout"
        }
      >
        <HomeLoadNotice />
        {checkingSession ? (
          <aside
            className="home-member-layout__summary"
            aria-label="Loading your Recipe Lab summary"
          >
            <SectionLoading
              count={3}
              label="Checking your account…"
              layout="summary"
            />
          </aside>
        ) : authenticatedSession ? (
          <aside
            className="home-member-layout__summary"
            aria-label={`${authenticatedSession.user.display_name}’s Recipe Lab summary`}
          >
            <MemberHomeSummary userId={authenticatedSession.user.id} />
          </aside>
        ) : null}
        <div className="home-member-layout__public">
          {children}
          <HomeCommunityFeed />
        </div>
      </div>
    </HomeLoadStateProvider>
  );
}
