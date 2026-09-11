"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useState } from "react";

import type { AccountCapabilities } from "../../features/auth/auth-api";
import { useAuthSession } from "../../features/auth/auth-session-provider";
import { AuthGateLoading } from "../../shared/ui/loading-ui";
import { RetryableStatePage } from "../../shared/ui/retryable-state-page";
import { StatePage, StatePanel } from "../../shared/ui/state-page";

type StaffCapability = keyof AccountCapabilities;
type StaffWorkspaceVariant = "curation" | "moderation";

interface StaffWorkspaceAccessProps {
  capability: StaffCapability;
  children: (onAuthorizationLost: () => void) => ReactNode;
  variant: StaffWorkspaceVariant;
}
export function StaffWorkspaceAccess({
  capability,
  children,
  variant,
}: StaffWorkspaceAccessProps) {
  const { state, refreshSession } = useAuthSession();
  const [authorizationLost, setAuthorizationLost] = useState(false);

  const handleAuthorizationLost = useCallback(() => {
    setAuthorizationLost(true);
    void refreshSession();
  }, [refreshSession]);

  if (state.phase === "loading") {
    return (
      <StaffStatePage phase="loading" variant={variant}>
        <AuthGateLoading className="staff-state-panel" />
      </StaffStatePage>
    );
  }

  if (state.phase === "error") {
    return (
      <RetryableStatePage
        className={staffStatePageClassName(variant, "error")}
        description="Try checking your account again, or browse the recipe collection."
        eyebrow="Something went wrong"
        headingId="staff-account-error-title"
        panelClassName="staff-state-panel"
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
      <StaffStatePage phase="concealed" variant={variant}>
        <StatePanel
          actions={
            <Link className="button button--primary" href="/recipes">
              Browse recipes
            </Link>
          }
          className="error-state staff-state-panel"
          description="Browse the recipe collection to find something to cook."
          headingId="staff-workspace-concealed-title"
          title="We couldn’t find that page."
        />
      </StaffStatePage>
    );
  }

  return children(handleAuthorizationLost);
}
interface StaffStatePageProps {
  children: ReactNode;
  phase: "concealed" | "loading";
  variant: StaffWorkspaceVariant;
}

function StaffStatePage({ children, phase, variant }: StaffStatePageProps) {
  return (
    <StatePage className={staffStatePageClassName(variant, phase)}>
      {children}
    </StatePage>
  );
}

function staffStatePageClassName(
  variant: StaffWorkspaceVariant,
  phase: "concealed" | "error" | "loading",
) {
  return `staff-state-page staff-state-page--${variant} staff-state-page--${phase}`;
}
