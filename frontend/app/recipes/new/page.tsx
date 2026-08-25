import type { Metadata } from "next";

import { RecipeDraftStarter } from "../../components/recipe-draft-starter";

export const metadata: Metadata = {
  title: "Start a recipe draft",
  description: "Start an original recipe in your private Recipe Lab workspace.",
};

export default function NewRecipePage() {
  return <RecipeDraftStarter sourceVersionId={null} />;
}
