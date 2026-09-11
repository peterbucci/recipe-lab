"use client";

import type { ReactNode } from "react";

import { useAuthSession } from "./auth-session-provider";
import { AuthGateLoading } from "../../shared/ui/loading-ui";
import { GuardedLink } from "../../shared/navigation/navigation-blocker-provider";
import { RetryableStatePage } from "../../shared/ui/retryable-state-page";
import { StatePage, StatePanel } from "../../shared/ui/state-page";

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

  const statePageClassName = ["auth-page", pageClassName]
    .filter(Boolean)
    .join(" ");
  const statePanelClassName = ["auth-card", cardClassName]
    .filter(Boolean)
    .join(" ");

  if (state.phase === "loading") {
    return (
      <StatePage className={statePageClassName}>
        <AuthGateLoading
          className={cardClassName}
          exitHref="/recipes"
          label="Checking your account…"
        />
      </StatePage>
    );
  }

  if (state.phase === "error") {
    return (
      <RetryableStatePage
        actionsClassName="auth-card__actions"
        className={statePageClassName}
        description="Try checking your account again."
        descriptionClassName="lede"
        eyebrow="Something went wrong"
        headingId="member-route-title"
        panelClassName={`${statePanelClassName} blocking-error-state`}
        retry={() => void refreshSession()}
        secondaryAction={
          <GuardedLink className="button button--secondary" href="/recipes">
            Browse recipes
          </GuardedLink>
        }
        title="We couldn’t check your account."
      />
    );
  }

  const signedOut = state.session.status === "anonymous";
  const destination = signedOut ? "/sign-in" : "/onboarding";
  const destinationHref = `${destination}?${new URLSearchParams({
    return_to: returnTo,
  }).toString()}`;

  return (
    <StatePage className={statePageClassName}>
      <StatePanel
        actions={
          <>
            <GuardedLink
              className="button button--primary"
              href={destinationHref}
            >
              {signedOut ? "Sign in" : "Finish account setup"}
            </GuardedLink>
            <GuardedLink className="button button--secondary" href="/recipes">
              Browse recipes
            </GuardedLink>
          </>
        }
        actionsClassName="auth-card__actions"
        className={statePanelClassName}
        description={
          signedOut
            ? signedOutDescription
            : "Complete your profile to continue."
        }
        descriptionClassName="lede"
        headingId="member-route-title"
        title={
          signedOut
            ? "Sign in to continue."
            : "Finish setting up your account."
        }
      />
    </StatePage>
  );
}
