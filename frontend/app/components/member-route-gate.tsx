"use client";

import type { ReactNode } from "react";

import { useAuthSession } from "./auth-session-provider";
import { GuardedLink } from "./navigation-blocker-provider";

interface MemberRouteGateProps {
  children: ReactNode;
  eyebrow: string;
  returnTo: string;
  title: string;
}

export function MemberRouteGate({
  children,
  eyebrow,
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

  const signInHref = `/sign-in?${new URLSearchParams({ return_to: returnTo }).toString()}`;
  const onboardingHref = `/onboarding?${new URLSearchParams({ return_to: returnTo }).toString()}`;
  let heading = "Checking your account…";
  let message = "Recipe Lab is checking that this private workspace belongs to you.";
  let action: ReactNode = (
    <span className="button button--disabled" aria-disabled="true">
      Checking account…
    </span>
  );

  if (state.phase === "error") {
    heading = "We couldn’t check your account";
    message = "Retry the account check before opening private recipe drafts.";
    action = (
      <button className="button button--primary" type="button" onClick={() => void refreshSession()}>
        Retry account check
      </button>
    );
  } else if (state.phase === "ready" && state.session.status === "anonymous") {
    heading = "Sign in to work on private recipes";
    message = "Drafts are private to your account and are never shown in the public recipe library.";
    action = (
      <GuardedLink className="button button--primary" href={signInHref}>
        Sign in to continue
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
    <main id="main-content" className="auth-page">
      <section className="auth-card" aria-labelledby="member-route-title">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="member-route-title">{heading}</h1>
        <p className="lede" role={state.phase === "loading" ? "status" : undefined}>
          {message}
        </p>
        <div className="button-row auth-card__actions">
          {action}
          <GuardedLink className="button button--secondary" href="/recipes">
            Browse recipes
          </GuardedLink>
        </div>
        <p className="auth-card__fine-print">{title}</p>
      </section>
    </main>
  );
}
