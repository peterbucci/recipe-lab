import Link from "next/link";

import { StatePage, StatePanel } from "../shared/ui/state-page";

export default function NotFound() {
  return (
    <StatePage className="system-state-page system-state-page--not-found">
      <StatePanel
        actions={
          <Link className="button button--primary" href="/recipes">
            Browse recipes
          </Link>
        }
        className="empty-state empty-state--large system-state-panel"
        description="Browse the recipe collection to find something to cook."
        headingId="not-found-title"
        title="We couldn’t find that page."
      />
    </StatePage>
  );
}
