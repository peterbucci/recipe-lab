"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthApiError, signOut } from "../../lib/auth-api";
import { useAuthSession } from "./auth-session-provider";
import { GuardedLink, useNavigationBlocker } from "./navigation-blocker-provider";

export function AccountMenu() {
  const router = useRouter();
  const { state, refreshSession, replaceSession } = useAuthSession();
  const { confirmNavigation, setBlocked } = useNavigationBlocker();
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function handleSignOut() {
    if (signOutPending || !confirmNavigation()) {
      return;
    }

    setSignOutPending(true);
    setSignOutError("");
    try {
      await signOut();
      setBlocked(false);
      replaceSession({ status: "anonymous" });
      router.replace("/");
      router.refresh();
    } catch (reason) {
      setSignOutError(
        reason instanceof AuthApiError && reason.status === 401
          ? "Your session expired. Sign in again to continue."
          : "We couldn’t sign you out. Please try again.",
      );
    } finally {
      setSignOutPending(false);
    }
  }

  if (state.phase === "loading") {
    return (
      <div className="account-slot account-slot--loading" role="status">
        <span className="visually-hidden">Checking account status…</span>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <button
        className="nav-link account-retry"
        type="button"
        onClick={() => void refreshSession()}
      >
        Retry account
      </button>
    );
  }

  if (state.session.status === "anonymous") {
    return (
      <GuardedLink className="button button--primary account-sign-in" href="/sign-in">
        Sign in
      </GuardedLink>
    );
  }

  const { user } = state.session;
  return (
    <details className="account-menu">
      <summary aria-label={`Account menu for ${user.display_name}`}>
        <span className="account-menu__avatar" aria-hidden="true">
          {user.display_name.trim().slice(0, 1).toLocaleUpperCase() || "C"}
        </span>
        <span className="account-menu__name">{user.display_name}</span>
      </summary>
      <div className="account-menu__panel">
        <p className="account-menu__identity">
          <strong>{user.display_name}</strong>
          {user.handle ? <span>@{user.handle}</span> : <span>Account setup not finished</span>}
        </p>
        {state.session.status === "onboarding_required" ? (
          <GuardedLink className="account-menu__link" href="/onboarding">
            Finish account setup
          </GuardedLink>
        ) : null}
        {state.session.status === "authenticated" ? (
          <GuardedLink
            className="account-menu__link"
            href={`/cooks/${encodeURIComponent(state.session.user.handle)}`}
          >
            Public profile
          </GuardedLink>
        ) : null}
        {state.session.status === "authenticated" ? (
          <GuardedLink className="account-menu__link" href="/account/recipes">
            My recipes
          </GuardedLink>
        ) : null}
        {state.session.status === "authenticated" ? (
          <GuardedLink className="account-menu__link" href="/account/saved-recipes">
            Saved recipes
          </GuardedLink>
        ) : null}
        {state.session.status === "authenticated" ? (
          <GuardedLink className="account-menu__link" href="/account/ingredient-requests">
            My ingredient requests
          </GuardedLink>
        ) : null}
        {state.session.status === "authenticated" &&
        state.session.capabilities?.review_ingredient_requests ? (
          <GuardedLink className="account-menu__link" href="/catalog/ingredient-requests">
            Review ingredient requests
          </GuardedLink>
        ) : null}
        <button
          className="account-menu__action"
          type="button"
          disabled={signOutPending}
          onClick={() => void handleSignOut()}
        >
          {signOutPending ? "Signing out…" : "Sign out"}
        </button>
        {signOutError ? (
          <p className="account-menu__error" role="alert">
            {signOutError}
          </p>
        ) : null}
      </div>
    </details>
  );
}
