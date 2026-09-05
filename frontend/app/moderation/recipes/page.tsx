import type { Metadata } from "next";

import { RecipeModerationWorkspace } from "../../components/recipe-moderation-workspace";

export const metadata: Metadata = {
  title: "Recipe reports",
  description: "Review private, de-identified reports about Recipe Lab recipes.",
};

export default function RecipeModerationPage() {
  return <RecipeModerationWorkspace />;
}
