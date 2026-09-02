"use client";

import { FlaskConical, Search } from "lucide-react";

import { AccountMenu } from "./account-menu";
import { useAuthSession } from "./auth-session-provider";
import { GuardedLink } from "./navigation-blocker-provider";

export function SiteHeader() {
  const { sessionExpired, state } = useAuthSession();
  const canCreateRecipe =
    !sessionExpired &&
    state.phase === "ready" &&
    state.session.status === "authenticated";

  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <div className="site-header__identity">
            <GuardedLink className="brand" href="/" aria-label="Recipe Lab home">
              <span className="brand__mark" aria-hidden="true">
                <FlaskConical focusable="false" />
              </span>
              <span className="brand__wordmark">Recipe Lab</span>
            </GuardedLink>
            <p className="site-header__tagline">Try it. Change it. Make it yours.</p>
          </div>

          <form
            className="site-header__search"
            action="/recipes"
            method="get"
            role="search"
            aria-label="Site recipe search"
          >
            <label className="visually-hidden" htmlFor="site-header-recipe-search">
              Search recipes
            </label>
            <Search aria-hidden="true" focusable="false" />
            <input
              id="site-header-recipe-search"
              name="q"
              type="search"
              placeholder="Search recipes"
            />
            <button type="submit" aria-label="Search recipes from the header">
              Search
            </button>
          </form>

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
        </div>
      </header>

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
    </>
  );
}
