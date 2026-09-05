"use client";

import { AccountMenu } from "./account-menu";
import { useAuthSession } from "./auth-session-provider";
import { GuardedLink } from "./navigation-blocker-provider";

function useCanCreateRecipe(): boolean {
  const { sessionExpired, state } = useAuthSession();
  return (
    !sessionExpired &&
    state.phase === "ready" &&
    state.session.status === "authenticated"
  );
}

export function SiteHeaderMemberActions() {
  const canCreateRecipe = useCanCreateRecipe();
  return (
    <div className="site-header__actions">
      {canCreateRecipe ? (
        <nav className="site-nav" aria-label="Primary navigation">
          <GuardedLink
            className="button button--primary site-header__create"
            href="/recipes/new"
          >
            Create recipe
          </GuardedLink>
        </nav>
      ) : null}

      <div className="site-header__account">
        <AccountMenu />
      </div>
    </div>
  );
}

export function SiteMobileNavigation() {
  const canCreateRecipe = useCanCreateRecipe();
  return (
    <nav
      className={`mobile-nav${canCreateRecipe ? " mobile-nav--with-create" : ""}`}
      aria-label="Mobile navigation"
    >
      <GuardedLink href="/">Home</GuardedLink>
      <GuardedLink href="/recipes" aria-label="Explore recipes">
        Discover
      </GuardedLink>
      <GuardedLink href="/account/recipes?view=drafts" aria-label="My recipes">
        My recipes
      </GuardedLink>
      {canCreateRecipe ? (
        <GuardedLink href="/recipes/new" aria-label="Create recipe">
          Create
        </GuardedLink>
      ) : null}
    </nav>
  );
}
