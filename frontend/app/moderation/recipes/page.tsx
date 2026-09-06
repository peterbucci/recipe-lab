import type { Metadata } from "next";

import { RecipeModerationRoute } from "./_components/recipe-moderation-route";

export const metadata: Metadata = {
  title: "Recipe reports",
  description: "Review private, de-identified reports about Recipe Lab recipes.",
};

export default function RecipeModerationPage() {
  return <RecipeModerationRoute />;
}
