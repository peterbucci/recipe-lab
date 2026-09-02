"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthApiError, signOut } from "../../lib/auth-api";
import { useAuthSession } from "./auth-session-provider";
import { LoadingBlock } from "./loading-ui";
import { GuardedLink, useNavigationBlocker } from "./navigation-blocker-provider";

export function AccountMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const { sessionExpired, state, refreshSession, replaceSession } = useAuthSession();
  const { confirmNavigation, setBlocked } = useNavigationBlocker();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  }, [pathname]);

  useEffect(() => {
    function closeMenuOnOutsidePointer(event: PointerEvent) {
      const menu = menuRef.current;
      if (!menu?.open || !(event.target instanceof Node) || menu.contains(event.target)) {
        return;
      }
      menu.open = false;
    }

    function closeMenuOnEscape(event: KeyboardEvent) {
      const menu = menuRef.current;
      if (event.key !== "Escape" || !menu?.open) {
        return;
      }
      event.preventDefault();
      menu.open = false;
      menu.querySelector("summary")?.focus();
    }

    document.addEventListener("pointerdown", closeMenuOnOutsidePointer, true);
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenuOnOutsidePointer, true);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, []);

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
      <div
        className="account-slot account-slot--loading"
        aria-busy="true"
      >
        <p
          className="visually-hidden"
          role={pathname === "/" ? undefined : "status"}
        >
          Checking account status…
        </p>
        <div className="account-slot__loading-content" aria-hidden="true">
          <LoadingBlock className="account-slot__loading-avatar" />
          <LoadingBlock className="account-slot__loading-name" />
          <LoadingBlock className="account-slot__loading-caret" />
        </div>
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

  if (sessionExpired) {
    const returnTo = pathname || "/recipes";
    return (
      <GuardedLink
        className="button button--primary account-sign-in"
        href={`/sign-in?${new URLSearchParams({ return_to: returnTo }).toString()}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Sign in
      </GuardedLink>
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
  const authenticated = state.session.status === "authenticated";
  const profileHref =
    state.session.status === "authenticated"
      ? `/cooks/${encodeURIComponent(state.session.user.handle)}`
      : null;
  const hasStaffTools =
    authenticated &&
    Boolean(
      state.session.capabilities?.review_ingredient_requests ||
        state.session.capabilities?.moderate_recipe_reports,
    );

  return (
    <details className="account-menu" ref={menuRef}>
      <summary aria-label={`Account menu for ${user.display_name}`}>
        <span className="account-menu__avatar" aria-hidden="true">
          {user.display_name.trim().slice(0, 1).toLocaleUpperCase() || "C"}
        </span>
        <span className="account-menu__name">{user.display_name}</span>
      </summary>
      <div className="account-menu__panel">
        {profileHref ? (
          <div className="account-menu__identity">
            <div className="account-menu__avatar" aria-hidden="true">
              {user.display_name.trim().slice(0, 1).toLocaleUpperCase() || "C"}
            </div>
            <div className="account-menu__identity-copy">
              <strong>{user.display_name}</strong>
              <span>@{user.handle}</span>
              <GuardedLink
                className="account-menu__identity-action"
                href={profileHref}
              >
                View profile
              </GuardedLink>
            </div>
          </div>
        ) : (
          <div className="account-menu__identity">
            <div className="account-menu__avatar" aria-hidden="true">
              {user.display_name.trim().slice(0, 1).toLocaleUpperCase() || "C"}
            </div>
            <p className="account-menu__identity-copy">
              <strong>{user.display_name}</strong>
              <span>Account setup not finished</span>
            </p>
          </div>
        )}
        <div className="account-menu__group">
          {state.session.status === "onboarding_required" ? (
            <GuardedLink className="account-menu__link" href="/onboarding">
              Finish account setup
            </GuardedLink>
          ) : null}
          {authenticated ? (
            <>
              <GuardedLink
                className="account-menu__link"
                href="/account/recipes?view=drafts"
              >
                My recipes
              </GuardedLink>
              <GuardedLink
                className="account-menu__link"
                href="/account/ingredient-requests"
              >
                Requests
              </GuardedLink>
            </>
          ) : null}
          <GuardedLink className="account-menu__link" href="/account/settings">
            Settings
          </GuardedLink>
        </div>
        {hasStaffTools ? (
          <div className="account-menu__group">
            <GuardedLink className="account-menu__link" href="/staff">
              Staff tools
            </GuardedLink>
          </div>
        ) : null}
        <div className="account-menu__group account-menu__group--sign-out">
          <button
            className="account-menu__action"
            type="button"
            disabled={signOutPending}
            aria-busy={signOutPending}
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
      </div>
    </details>
  );
}
