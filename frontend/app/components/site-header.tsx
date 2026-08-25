import { AccountMenu } from "./account-menu";
import { GuardedLink } from "./navigation-blocker-provider";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <GuardedLink className="brand" href="/" aria-label="Recipe Lab home">
          <span>Recipe Lab</span>
        </GuardedLink>
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
          <AccountMenu />
        </nav>
      </div>
    </header>
  );
}
