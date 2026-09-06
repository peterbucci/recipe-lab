import type { Metadata } from "next";

import { IngredientRequestReviewRoute } from "./_components/ingredient-request-review-route";

export const metadata: Metadata = {
  title: "Ingredient requests",
  description: "Review missing-ingredient requests for the curated Recipe Lab catalog.",
};

export default function IngredientRequestReviewPage() {
  return <IngredientRequestReviewRoute />;
}
