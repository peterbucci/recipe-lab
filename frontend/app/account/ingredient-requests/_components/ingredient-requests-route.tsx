"use client";

import { MyIngredientRequestsWorkspace } from "../../../../features/ingredients/requests/my-ingredient-requests-workspace";
import { MemberRouteGate } from "../../../components/member-route-gate";

const RETURN_TO = "/account/ingredient-requests";

export function IngredientRequestsRoute() {
  return (
    <MemberRouteGate
      eyebrow="Ingredient requests"
      pageClassName="account-workspace-page account-ingredient-requests-page"
      returnTo={RETURN_TO}
      title="Ingredient Requests"
    >
      <MyIngredientRequestsWorkspace />
    </MemberRouteGate>
  );
}
