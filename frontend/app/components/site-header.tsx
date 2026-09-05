import { FlaskConical, Search } from "lucide-react";

import { GuardedLink } from "./navigation-blocker-provider";
import {
  SiteHeaderMemberActions,
  SiteMobileNavigation,
} from "./site-header-member-navigation";

export function SiteHeader() {
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

          <SiteHeaderMemberActions />
        </div>
      </header>

      <SiteMobileNavigation />
    </>
  );
}
