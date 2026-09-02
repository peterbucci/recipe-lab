import type { Metadata } from "next";

import { MyIngredientRequestsWorkspace } from "../../components/my-ingredient-requests-workspace";

export const metadata: Metadata = {
  title: "Ingredient Requests",
  description: "Track ingredients you've asked Recipe Lab to add to the catalog.",
};

export default function MyIngredientRequestsPage() {
  return <MyIngredientRequestsWorkspace />;
}
