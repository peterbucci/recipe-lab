import type { Metadata } from "next";

import { IngredientRequestReviewWorkspace } from "../../components/ingredient-request-review-workspace";

export const metadata: Metadata = {
  title: "Ingredient requests",
  description: "Review missing-ingredient requests for the curated Recipe Lab catalog.",
};

export default function IngredientRequestReviewPage() {
  return <IngredientRequestReviewWorkspace />;
}
