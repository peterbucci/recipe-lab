import { AccountMenu } from "./account-menu";
import { GuardedLink } from "./navigation-blocker-provider";

export function SiteHeader() {
  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <GuardedLink className="brand" href="/" aria-label="Recipe Lab home">
            <span className="brand__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M9 2h6M10 2v5l-5.4 9.3A3.8 3.8 0 0 0 7.9 22h8.2a3.8 3.8 0 0 0 3.3-5.7L14 7V2" />
                <path d="M7.6 15h8.8M9.2 12.3h5.6" />
              </svg>
            </span>
            <span className="brand__wordmark">Recipe Lab</span>
          </GuardedLink>

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
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
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

          <nav className="site-nav" aria-label="Primary navigation">
            <GuardedLink className="nav-link site-nav__link" href="/recipes">
              Explore recipes
            </GuardedLink>
            <GuardedLink
              className="nav-link site-nav__link site-nav__secondary"
              href="/#how-it-works"
            >
              How it works
            </GuardedLink>
            <GuardedLink
              className="button button--primary site-header__create"
              href="/recipes/new"
            >
              Create recipe
            </GuardedLink>
          </nav>

          <div className="site-header__account">
            <AccountMenu />
          </div>
        </div>
      </header>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <GuardedLink href="/">Home</GuardedLink>
        <GuardedLink href="/recipes" aria-label="Explore recipes">
          Explore
        </GuardedLink>
        <GuardedLink href="/recipes/new" aria-label="Create recipe">
          Create
        </GuardedLink>
        <GuardedLink href="/#how-it-works">How it works</GuardedLink>
      </nav>
    </>
  );
}
