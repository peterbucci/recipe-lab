import { FlaskConical } from "lucide-react";

import { GuardedLink } from "./navigation-blocker-provider";

const COPYRIGHT_YEAR = 2026;

function FutureDestination({ children }: { children: string }) {
  return (
    <span
      className="site-footer__destination site-footer__destination--inactive"
      aria-disabled="true"
      aria-label={`${children}, coming soon`}
    >
      {children}
    </span>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__identity">
        <GuardedLink
          className="site-footer__home"
          href="/"
          aria-label="Recipe Lab home"
        >
          <span className="brand__mark" aria-hidden="true">
            <FlaskConical focusable="false" />
          </span>
          <strong>Recipe Lab</strong>
        </GuardedLink>
        <p className="site-footer__tagline">
          Try it. Change it. Make it yours.
        </p>
      </div>

      <nav className="site-footer__navigation" aria-label="Footer navigation">
        <section aria-labelledby="footer-explore-heading">
          <h2 id="footer-explore-heading">Explore</h2>
          <GuardedLink className="site-footer__link" href="/recipes">
            Recipes
          </GuardedLink>
          <FutureDestination>How it works</FutureDestination>
          <FutureDestination>Categories</FutureDestination>
        </section>
        <section aria-labelledby="footer-support-heading">
          <h2 id="footer-support-heading">Support</h2>
          <GuardedLink className="site-footer__link" href="/community-rules">
            Community rules
          </GuardedLink>
          <FutureDestination>Help</FutureDestination>
          <FutureDestination>Privacy</FutureDestination>
        </section>
        <section aria-labelledby="footer-about-heading">
          <h2 id="footer-about-heading">About</h2>
          <FutureDestination>About Recipe Lab</FutureDestination>
          <FutureDestination>Community</FutureDestination>
          <FutureDestination>Terms</FutureDestination>
        </section>
      </nav>

      <p className="site-footer__copyright">
        <small>© {COPYRIGHT_YEAR} Recipe Lab.</small>
      </p>
    </footer>
  );
}
