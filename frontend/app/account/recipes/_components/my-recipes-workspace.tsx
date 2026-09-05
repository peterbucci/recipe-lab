"use client";

import { MemberRouteGate } from "../../../components/member-route-gate";
import { MyRecipeLibrary } from "../../../../features/recipes/library/my-recipe-library";
import {
  myRecipesHref,
  type MyRecipesHubView,
} from "../../../../features/recipes/library/my-recipes-hub";
import { SavedRecipeLibrary } from "../../../../features/recipes/library/saved-recipe-library";

interface MyRecipesWorkspaceProps {
  pageNumber: number;
  view: MyRecipesHubView;
}

export function MyRecipesWorkspace({
  pageNumber,
  view,
}: MyRecipesWorkspaceProps) {
  if (view === "saved") {
    return (
      <MemberRouteGate
        anonymousHeading="Sign in to open My recipes"
        anonymousMessage="Your drafts, saves, and other private recipe activity belong only to your account."
        eyebrow="Your recipe workspace"
        returnTo="/account/recipes?view=saved"
        title="My recipes"
      >
        <SavedRecipeLibrary />
      </MemberRouteGate>
    );
  }

  return (
    <MemberRouteGate
      eyebrow="Your recipe workspace"
      returnTo={myRecipesHref(view, pageNumber)}
      title="My recipes"
    >
      <MyRecipeLibrary pageNumber={pageNumber} view={view} />
    </MemberRouteGate>
  );
}
