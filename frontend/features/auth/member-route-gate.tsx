"use client";

import type { ReactNode } from "react";

import { useAuthSession } from "./auth-session-provider";
import { AuthGateLoading } from "../../shared/ui/loading-ui";
import { GuardedLink } from "../../shared/navigation/navigation-blocker-provider";

interface MemberRouteGateProps {
  cardClassName?: string;
  children: ReactNode;
  pageClassName?: string;
  returnTo: string;
  signedOutDescription?: string;
}

const DEFAULT_SIGNED_OUT_DESCRIPTION =
  "This page is available to signed-in members.";

export function MemberRouteGate({
  cardClassName,
  children,
  pageClassName,
  returnTo,
  signedOutDescription = DEFAULT_SIGNED_OUT_DESCRIPTION,
}: MemberRouteGateProps) {
  const { state, refreshSession } = useAuthSession();
  const authenticated =
    state.phase === "ready" && state.session.status === "authenticated";

  // The session provider retains the last authenticated UI state during an
  // interruption, so this branch remains mounted without a render-time latch.
  if (authenticated) {
    return children;
  }

  if (state.phase === "loading") {
    return (
      <main
        id="main-content"
        className={pageClassName ? `auth-page ${pageClassName}` : "auth-page"}
      >
        <AuthGateLoading
          className={cardClassName}
          exitHref="/recipes"
          label="Checking your account…"
        />
      </main>
    );
  }

  const signInHref = `/sign-in?${new URLSearchParams({ return_to: returnTo }).toString()}`;
  const onboardingHref = `/onboarding?${new URLSearchParams({ return_to: returnTo }).toString()}`;
  const accountCheckFailed = state.phase === "error";
  let heading = "Checking your account…";
  let message = "Recipe Lab is checking your account.";
  let action: ReactNode = null;

  if (state.phase === "error") {
    heading = "We couldn’t check your account.";
    message = "Try checking your account again.";
    action = (
      <button
        className="button button--primary"
        type="button"
        onClick={() => void refreshSession()}
      >
        Try again
      </button>
    );
  } else if (state.phase === "ready" && state.session.status === "anonymous") {
    heading = "Sign in to continue.";
    message = signedOutDescription;
    action = (
      <GuardedLink className="button button--primary" href={signInHref}>
        Sign in
      </GuardedLink>
    );
  } else if (
    state.phase === "ready" &&
    state.session.status === "onboarding_required"
  ) {
    heading = "Finish setting up your account.";
    message = "Complete your profile to continue.";
    action = (
      <GuardedLink className="button button--primary" href={onboardingHref}>
        Finish account setup
      </GuardedLink>
    );
  }

  return (
    <main
      id="main-content"
      className={pageClassName ? `auth-page ${pageClassName}` : "auth-page"}
    >
      <section
        className={[
          "auth-card",
          cardClassName,
          accountCheckFailed ? "blocking-error-state" : null,
        ]
          .filter(Boolean)
          .join(" ")}
        role={accountCheckFailed ? "alert" : undefined}
        aria-labelledby="member-route-title"
        aria-describedby="member-route-description"
      >
        {accountCheckFailed ? (
          <p className="eyebrow">Something went wrong</p>
        ) : null}
        <h1 id="member-route-title">{heading}</h1>
        <p className="lede" id="member-route-description">
          {message}
        </p>
        <div className="button-row auth-card__actions">
          {action}
          <GuardedLink className="button button--secondary" href="/recipes">
            Browse recipes
          </GuardedLink>
        </div>
      </section>
    </main>
  );
}
