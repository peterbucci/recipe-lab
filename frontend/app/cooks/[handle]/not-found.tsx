import Link from "next/link";

import { StatePage, StatePanel } from "../../../shared/ui/state-page";

export default function CookProfileNotFound() {
  return (
    <StatePage>
      <StatePanel
        actions={
          <Link className="button button--primary" href="/recipes">
            Browse recipes
          </Link>
        }
        className="state-panel--wide state-panel--large"
        description="Browse the recipe collection to find another cook."
        eyebrow="Cook not found"
        headingId="cook-profile-not-found-title"
        title="We couldn’t find that cook."
      />
    </StatePage>
  );
}
