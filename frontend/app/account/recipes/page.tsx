import type { Metadata } from "next";

import { MemberRouteGate } from "../../../features/auth/member-route-gate";
import { MyRecipeLibrary } from "../../../features/recipes/library/my-recipe-library";
import {
  myRecipesHref,
  parseMyRecipesView,
} from "../../../features/recipes/library/my-recipes-route";
import { SavedRecipeLibrary } from "../../../features/recipes/library/saved-recipe-library";
import { parsePositivePageNumber } from "../../../shared/navigation/query-params";

export const metadata: Metadata = {
  title: "My recipes",
  description: "Find private drafts and manage which published recipes are public.",
};

interface MyRecipesPageProps {
  searchParams: Promise<{
    page?: string | string[];
    view?: string | string[];
  }>;
}

export default async function MyRecipesPage({ searchParams }: MyRecipesPageProps) {
  const query = await searchParams;
  const view = parseMyRecipesView(query.view);
  const currentPage = parsePositivePageNumber(query.page);

  if (view === "saved") {
    return (
      <MemberRouteGate
        returnTo={myRecipesHref(view, currentPage)}
        signedOutDescription="Your drafts, saves, and other private recipe activity belong only to your account."
      >
        <SavedRecipeLibrary pageNumber={currentPage} />
      </MemberRouteGate>
    );
  }

  return (
    <MemberRouteGate returnTo={myRecipesHref(view, currentPage)}>
      <MyRecipeLibrary pageNumber={currentPage} view={view} />
    </MemberRouteGate>
  );
}
