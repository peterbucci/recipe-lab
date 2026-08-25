import type { Metadata } from "next";

import { RecipeDraftWorkspace } from "../../components/recipe-draft-workspace";

export const metadata: Metadata = {
  title: "My recipe drafts",
  description: "Create, resume, and discard private recipe drafts.",
};

export default function RecipeDraftsPage() {
  return <RecipeDraftWorkspace />;
}
