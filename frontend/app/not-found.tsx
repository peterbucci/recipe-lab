import Link from "next/link";

import { StatePage, StatePanel } from "../shared/ui/state-page";

export default function NotFound() {
  return (
    <StatePage>
      <StatePanel
        actions={
          <Link className="button button--primary" href="/recipes">
            Browse recipes
          </Link>
        }
        className="state-panel--large"
        description="Browse the recipe collection to find something to cook."
        headingId="not-found-title"
        title="We couldn’t find that page."
      />
    </StatePage>
  );
}
