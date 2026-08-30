"use client";

import type { ReactNode } from "react";

import { useAuthSession } from "./auth-session-provider";
import { MemberHomeSummary } from "./member-home-summary";

interface HomeDashboardLayoutProps {
  children: ReactNode;
}

export function HomeDashboardLayout({ children }: HomeDashboardLayoutProps) {
  const { state } = useAuthSession();
  const authenticatedSession =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session
      : null;

  return (
    <div
      className={
        authenticatedSession
          ? "home-member-layout home-member-layout--authenticated"
          : "home-member-layout"
      }
    >
      {authenticatedSession ? (
        <aside
          className="home-member-layout__summary"
          aria-label={`${authenticatedSession.user.display_name}’s Recipe Lab summary`}
        >
          <MemberHomeSummary userId={authenticatedSession.user.id} />
        </aside>
      ) : null}
      <div className="home-member-layout__public">{children}</div>
    </div>
  );
}
