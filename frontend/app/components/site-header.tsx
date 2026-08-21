import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" href="/" aria-label="Recipe Lab home">
          <span className="brand__mark" aria-hidden="true">
            RL
          </span>
          <span>Recipe Lab</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link className="nav-link" href="/recipes">
            Browse recipes
          </Link>
        </nav>
      </div>
    </header>
  );
}
