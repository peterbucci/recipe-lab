"use client";

import { Plus } from "lucide-react";

import { GuardedLink } from "../../../shared/navigation/navigation-blocker-provider";
import {
  WorkspaceTabCount,
  WorkspaceTabMenu,
} from "../../../shared/ui/workspace-tab-menu";
import {
  MY_RECIPE_VIEWS,
  myRecipesHref,
  type MyRecipesHubView,
} from "./my-recipes-route";

export { myRecipesHref } from "./my-recipes-route";
export type { MyRecipesHubView } from "./my-recipes-route";

function viewLabel(view: MyRecipesHubView): string {
  return view.slice(0, 1).toUpperCase() + view.slice(1);
}

export function MyRecipesHubHeader() {
  return (
    <header className="page-intro member-library__intro">
      <div>
        <h1>My recipes</h1>
        <p>Keep your drafts, published recipes, and favorites in one place.</p>
      </div>
      <GuardedLink
        aria-label="Start a new recipe"
        className="button button--primary member-library__create"
        href="/recipes/new"
      >
        <Plus
          aria-hidden="true"
          className="member-library__create-icon"
        />
        <span>Start a new recipe</span>
      </GuardedLink>
    </header>
  );
}

export function MyRecipesHubNavigation({
  activeCount,
  activeView,
}: {
  activeCount?: number | null;
  activeView: MyRecipesHubView;
}) {
  return (
    <WorkspaceTabMenu
      as="nav"
      className="member-library__views"
      aria-label="My recipe views"
      itemsOnly
    >
      {MY_RECIPE_VIEWS.map((view) => (
        <GuardedLink
          aria-current={view === activeView ? "page" : undefined}
          className="member-library__view-link workspace-tab-menu__item"
          href={myRecipesHref(view)}
          key={view}
        >
          {viewLabel(view)}
          {view === activeView && activeCount !== null && activeCount !== undefined ? (
            <WorkspaceTabCount>{activeCount}</WorkspaceTabCount>
          ) : null}
        </GuardedLink>
      ))}
    </WorkspaceTabMenu>
  );
}
