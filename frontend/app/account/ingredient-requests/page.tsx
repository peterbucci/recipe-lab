import type { Metadata } from "next";

import { MyIngredientRequestsWorkspace } from "../../components/my-ingredient-requests-workspace";

export const metadata: Metadata = {
  title: "My ingredient requests",
  description: "Track your missing-ingredient requests and their catalog resolutions.",
};

export default function MyIngredientRequestsPage() {
  return <MyIngredientRequestsWorkspace />;
}
