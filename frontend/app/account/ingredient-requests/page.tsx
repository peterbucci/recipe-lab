import type { Metadata } from "next";

import { MemberRouteGate } from "../../../features/auth/member-route-gate";
import { MyIngredientRequestsWorkspace } from "../../../features/ingredients/requests/my-ingredient-requests-workspace";

export const metadata: Metadata = {
  title: "Ingredient Requests",
  description: "Track ingredients you've asked Recipe Lab to add to the catalog.",
};

export default function MyIngredientRequestsPage() {
  return (
    <MemberRouteGate
      eyebrow="Ingredient requests"
      pageClassName="account-workspace-page account-ingredient-requests-page"
      returnTo="/account/ingredient-requests"
      title="Ingredient Requests"
    >
      <MyIngredientRequestsWorkspace />
    </MemberRouteGate>
  );
}
