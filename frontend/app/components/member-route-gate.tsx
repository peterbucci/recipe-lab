"use client";

import type { ReactNode } from "react";

import { useAuthSession } from "./auth-session-provider";
import { AuthGateLoading } from "./loading-ui";
import { GuardedLink } from "./navigation-blocker-provider";

interface MemberRouteGateProps {
  anonymousHeading?: string;
  anonymousMessage?: string;
  cardClassName?: string;
  children: ReactNode;
  eyebrow: string;
  pageClassName?: string;
  returnTo: string;
  title: string;
}

const DEFAULT_ANONYMOUS_HEADING = "Page Unavailable";
const DEFAULT_ANONYMOUS_MESSAGE = "Please sign in to continue";

export function MemberRouteGate({
  anonymousHeading = DEFAULT_ANONYMOUS_HEADING,
  anonymousMessage = DEFAULT_ANONYMOUS_MESSAGE,
  cardClassName,
  children,
  eyebrow,
  pageClassName,
  returnTo,
  title,
}: MemberRouteGateProps) {
  const { state, refreshSession } = useAuthSession();
  const authenticated = state.phase === "ready" && state.session.status === "authenticated";

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
  const sharedAnonymousState =
    state.phase === "ready" &&
    state.session.status === "anonymous" &&
    anonymousHeading === DEFAULT_ANONYMOUS_HEADING &&
    anonymousMessage === DEFAULT_ANONYMOUS_MESSAGE;
  let stateEyebrow: string | null = eyebrow;
  let heading = "Checking your account…";
  let message = "Recipe Lab is checking that this private workspace belongs to you.";
  let action: ReactNode = null;

  if (state.phase === "error") {
    stateEyebrow = "Something went wrong";
    heading = "We couldn’t check your account";
    message = "Retry the account check before opening private recipe drafts.";
    action = (
      <button className="button button--primary" type="button" onClick={() => void refreshSession()}>
        Try again
      </button>
    );
  } else if (state.phase === "ready" && state.session.status === "anonymous") {
    if (sharedAnonymousState) {
      stateEyebrow = null;
    }
    heading = anonymousHeading;
    message = anonymousMessage;
    action = (
      <GuardedLink className="button button--primary" href={signInHref}>
        {sharedAnonymousState ? "Sign In" : "Sign in to continue"}
      </GuardedLink>
    );
  } else if (state.phase === "ready" && state.session.status === "onboarding_required") {
    heading = "Finish setting up your account";
    message = "Choose your account details before creating or editing a private recipe draft.";
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
          sharedAnonymousState ? "member-route-gate--shared-anonymous" : null,
          accountCheckFailed ? "blocking-error-state" : null,
        ]
          .filter(Boolean)
          .join(" ")}
        role={accountCheckFailed ? "alert" : undefined}
        aria-labelledby="member-route-title"
      >
        {stateEyebrow ? <p className="eyebrow">{stateEyebrow}</p> : null}
        <h1 id="member-route-title">{heading}</h1>
        <p className="lede">{message}</p>
        <div className="button-row auth-card__actions">
          {action}
          <GuardedLink className="button button--secondary" href="/recipes">
            {sharedAnonymousState ? "Browse Recipes" : "Browse recipes"}
          </GuardedLink>
        </div>
        {accountCheckFailed || sharedAnonymousState ? null : (
          <p className="auth-card__fine-print">{title}</p>
        )}
      </section>
    </main>
  );
}
