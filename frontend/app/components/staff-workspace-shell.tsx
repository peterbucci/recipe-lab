"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useState } from "react";

import type { AccountCapabilities } from "../../lib/auth-api";
import { useAuthSession } from "./auth-session-provider";
import { AuthGateLoading } from "./loading-ui";

type StaffCapability = keyof AccountCapabilities;
type StaffWorkspaceVariant = "curation" | "moderation";

interface StaffWorkspaceAccessProps {
  capability: StaffCapability;
  children: (onAuthorizationLost: () => void) => ReactNode;
  loadingLabel: string;
  variant: StaffWorkspaceVariant;
}

export function StaffWorkspaceAccess({
  capability,
  children,
  loadingLabel,
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
        <AuthGateLoading className="staff-state-panel" label={loadingLabel} />
      </StaffStatePage>
    );
  }

  if (state.phase === "error") {
    return (
      <StaffStatePage phase="error" variant={variant}>
        <div className="error-state staff-state-panel" role="alert">
          <p className="eyebrow">Account unavailable</p>
          <h1>We couldn’t check access.</h1>
          <p>Try checking your account again, or return to the recipe collection.</p>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void refreshSession()}
            >
              Try again
            </button>
            <Link className="button button--secondary" href="/recipes">
              Browse recipes
            </Link>
          </div>
        </div>
      </StaffStatePage>
    );
  }

  if (
    authorizationLost ||
    state.session.status !== "authenticated" ||
    !state.session.capabilities?.[capability]
  ) {
    return (
      <StaffStatePage phase="authorization" variant={variant}>
        <div className="error-state staff-state-panel" role="alert">
          <h1>We couldn’t find that page.</h1>
          <p>Browse the recipe collection to find something to cook.</p>
          <Link className="button button--primary" href="/recipes">
            Browse recipes
          </Link>
        </div>
      </StaffStatePage>
    );
  }

  return children(handleAuthorizationLost);
}

interface StaffStatePageProps {
  children: ReactNode;
  phase: "authorization" | "error" | "loading";
  variant: StaffWorkspaceVariant;
}

function StaffStatePage({ children, phase, variant }: StaffStatePageProps) {
  return (
    <main
      id="main-content"
      className={`state-page staff-state-page staff-state-page--${variant} staff-state-page--${phase}`}
    >
      {children}
    </main>
  );
}

interface StaffWorkspaceShellProps {
  children: ReactNode;
  className: string;
  description: string;
  headerAction?: ReactNode;
  headerClassName: string;
  title: string;
  variant: StaffWorkspaceVariant;
}

export function StaffWorkspaceShell({
  children,
  className,
  description,
  headerAction,
  headerClassName,
  title,
  variant,
}: StaffWorkspaceShellProps) {
  const copy = (
    <>
      <h1>{title}</h1>
      <p>{description}</p>
    </>
  );

  return (
    <main
      id="main-content"
      className={`page-shell staff-workspace staff-workspace--${variant} ${className}`}
    >
      <header className={`staff-workspace__header ${headerClassName}`}>
        {headerAction ? (
          <>
            <div className="staff-workspace__header-copy">{copy}</div>
            {headerAction}
          </>
        ) : (
          copy
        )}
      </header>
      {children}
    </main>
  );
}

interface StaffWorkspaceSplitPanelProps {
  children: ReactNode;
  className: string;
  detailClassName: string;
  detailHeadingId: string;
  queue: ReactNode;
}

export function StaffWorkspaceSplitPanel({
  children,
  className,
  detailClassName,
  detailHeadingId,
  queue,
}: StaffWorkspaceSplitPanelProps) {
  return (
    <div className={`staff-workspace__layout ${className}`}>
      {queue}
      <section
        className={`staff-panel-surface staff-workspace__detail ${detailClassName}`}
        aria-labelledby={detailHeadingId}
      >
        {children}
      </section>
    </div>
  );
}
