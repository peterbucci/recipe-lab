"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useState } from "react";

import type { AccountCapabilities } from "../../features/auth/auth-api";
import { useAuthSession } from "../../features/auth/auth-session-provider";
import { AuthGateLoading } from "../../shared/ui/loading-ui";
import { RetryableStatePage } from "../../shared/ui/retryable-state-page";
import { StatePage, StatePanel } from "../../shared/ui/state-page";

type StaffCapability = keyof AccountCapabilities;
interface StaffWorkspaceAccessProps {
  capability: StaffCapability;
  children: (onAuthorizationLost: () => void) => ReactNode;
}
export function StaffWorkspaceAccess({
  capability,
  children,
}: StaffWorkspaceAccessProps) {
  const { state, refreshSession } = useAuthSession();
  const [authorizationLost, setAuthorizationLost] = useState(false);

  const handleAuthorizationLost = useCallback(() => {
    setAuthorizationLost(true);
    void refreshSession();
  }, [refreshSession]);

  if (state.phase === "loading") {
    return (
      <StatePage>
        <AuthGateLoading />
      </StatePage>
    );
  }

  if (state.phase === "error") {
    return (
      <RetryableStatePage
        description="Try checking your account again, or browse the recipe collection."
        eyebrow="Something went wrong"
        headingId="staff-account-error-title"
        retry={() => void refreshSession()}
        secondaryAction={
          <Link className="button button--secondary" href="/recipes">
            Browse recipes
          </Link>
        }
        title="We couldn’t check your account."
      />
    );
  }

  if (
    authorizationLost ||
    state.session.status !== "authenticated" ||
    !state.session.capabilities?.[capability]
  ) {
    return (
      <StatePage>
        <StatePanel
          actions={
            <Link className="button button--primary" href="/recipes">
              Browse recipes
            </Link>
          }
          className="state-panel--large"
          description="Browse the recipe collection to find something to cook."
          headingId="staff-workspace-concealed-title"
          title="We couldn’t find that page."
        />
      </StatePage>
    );
  }

  return children(handleAuthorizationLost);
}
