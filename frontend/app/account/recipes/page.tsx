import type { Metadata } from "next";

import { MyRecipeLibrary } from "../../components/my-recipe-library";

export const metadata: Metadata = {
  title: "My recipes",
  description: "Find your private drafts, published originals, and published forks.",
};

export default function MyRecipesPage() {
  return <MyRecipeLibrary />;
}
