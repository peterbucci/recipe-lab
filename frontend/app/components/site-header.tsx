import Link from "next/link";

import { AccountMenu } from "./account-menu";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label="Recipe Lab home">
          <span>Recipe Lab</span>
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link className="nav-link site-nav__link" href="/recipes">
            Explore recipes
          </Link>
          <Link
            className="nav-link site-nav__link site-nav__secondary"
            href="/#how-it-works"
          >
            How it works
          </Link>
          <AccountMenu />
        </nav>
      </div>
    </header>
  );
}
