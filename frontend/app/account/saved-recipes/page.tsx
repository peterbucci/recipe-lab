import type { Metadata } from "next";

import { SavedRecipeLibrary } from "../../components/saved-recipe-library";

export const metadata: Metadata = {
  title: "Saved recipes",
  description: "Return to the public recipe versions you saved for later.",
};

export default function SavedRecipesPage() {
  return <SavedRecipeLibrary />;
}
