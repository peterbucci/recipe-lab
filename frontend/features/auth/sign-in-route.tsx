"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { AuthGateLoading } from "../../shared/ui/loading-ui";
import { safeReturnTo, type AuthSession } from "./auth-api";
import { useAuthSession } from "./auth-session-provider";

interface SignInRouteProps {
  children: ReactNode;
  returnTo: string;
}

export function SignInRoute({ children, returnTo }: SignInRouteProps) {
  const { state } = useAuthSession();
  if (state.phase === "loading") {
    return (
      <main
        id="main-content"
        className="auth-page account-access-page account-access-page--sign-in"
      >
        <AuthGateLoading
          className="auth-card account-access-card account-access-card--sign-in"
          exitHref="/recipes"
          label="Checking your account…"
        />
      </main>
    );
  }

  if (state.phase === "error") {
    return children;
  }

  return (
    <ResolvedSignInRoute
      initialStatus={state.session.status}
      returnTo={returnTo}
    >
      {children}
    </ResolvedSignInRoute>
  );
}

interface ResolvedSignInRouteProps extends SignInRouteProps {
  initialStatus: AuthSession["status"];
}

function ResolvedSignInRoute({
  children,
  initialStatus,
  returnTo,
}: ResolvedSignInRouteProps) {
  const router = useRouter();
  const [entryStatus] = useState(initialStatus);

  useEffect(() => {
    if (entryStatus === "onboarding_required") {
      router.replace(
        `/onboarding?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`,
      );
    } else if (entryStatus === "authenticated") {
      router.replace("/");
    }
  }, [entryStatus, returnTo, router]);

  if (entryStatus !== "anonymous") {
    return (
      <main
        id="main-content"
        className="auth-page account-access-page account-access-page--sign-in"
      >
        <AuthGateLoading
          className="auth-card account-access-card account-access-card--sign-in"
          exitHref="/recipes"
          label={
            entryStatus === "onboarding_required"
              ? "Opening account setup…"
              : "Opening your homepage…"
          }
        />
      </main>
    );
  }

  return children;
}
