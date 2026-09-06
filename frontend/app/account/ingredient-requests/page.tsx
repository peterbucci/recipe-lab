import type { Metadata } from "next";

import { IngredientRequestsRoute } from "./_components/ingredient-requests-route";

export const metadata: Metadata = {
  title: "Ingredient Requests",
  description: "Track ingredients you've asked Recipe Lab to add to the catalog.",
};

export default function MyIngredientRequestsPage() {
  return <IngredientRequestsRoute />;
}
