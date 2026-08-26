import type { Metadata } from "next";

import { MyRecipeLibrary } from "../../components/my-recipe-library";

export const metadata: Metadata = {
  title: "My recipes",
  description: "Find private drafts and manage the visibility of published recipe snapshots.",
};

export default function MyRecipesPage() {
  return <MyRecipeLibrary />;
}
