"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { safeReturnTo } from "../../../lib/auth-api";
import { useAuthSession } from "../../components/auth-session-provider";
import { AuthGateLoading } from "../../components/loading-ui";

interface CallbackStatusProps {
  errorCode?: string;
  returnTo: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was canceled. No changes were made to your account.",
  authentication_unavailable: "Sign-in is temporarily unavailable. Please try again.",
  authentication_failed: "The identity provider could not complete sign-in.",
  invalid_login: "This sign-in attempt expired or was already used.",
  invalid_state: "This sign-in link expired or was already used.",
  provider_unavailable: "The identity provider is temporarily unavailable.",
  reauthentication_failed: "We couldn’t verify your identity. No account changes were made.",
};

export function CallbackStatus({ errorCode, returnTo }: CallbackStatusProps) {
  const router = useRouter();
  const { state, refreshSession } = useAuthSession();

  useEffect(() => {
    if (errorCode || state.phase !== "ready") {
      return;
    }
    if (state.session.status === "onboarding_required") {
      router.replace(`/onboarding?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`);
    }
    if (state.session.status === "authenticated") {
      router.replace(safeReturnTo(returnTo));
    }
  }, [errorCode, returnTo, router, state]);

  if (errorCode) {
    const reauthenticationFailed = errorCode === "reauthentication_failed";
    return (
      <div
        className="auth-state account-access-state account-access-state--error"
        role="alert"
      >
        <strong>
          {reauthenticationFailed
            ? "We couldn’t verify your identity."
            : "We couldn’t sign you in."}
        </strong>
        <p>{ERROR_MESSAGES[errorCode] ?? "Sign-in could not be completed. Please try again."}</p>
        {reauthenticationFailed ? (
          <Link className="button button--primary" href="/account/settings">
            Return to account settings
          </Link>
        ) : (
          <Link className="button button--primary" href="/sign-in">
            Try signing in again
          </Link>
        )}
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div
        className="auth-state account-access-state account-access-state--error"
        role="alert"
      >
        <strong>We couldn’t confirm your account.</strong>
        <button className="button button--secondary" onClick={() => void refreshSession()}>
          Try again
        </button>
      </div>
    );
  }

  if (state.phase === "ready" && state.session.status === "anonymous") {
    return (
      <div
        className="auth-state account-access-state account-access-state--error"
        role="alert"
      >
        <strong>Sign-in could not be completed.</strong>
        <p>Your session was not created. Please start again.</p>
        <Link className="button button--primary" href="/sign-in">
          Return to sign in
        </Link>
      </div>
    );
  }

  return (
    <AuthGateLoading
      className="auth-state account-access-state account-access-state--loading"
      exitHref="/sign-in"
      label="Finishing sign-in…"
    />
  );
}
