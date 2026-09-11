"use client";

import { IngredientRequestReviewWorkspace } from "../../../../features/ingredients/review/ingredient-request-review-workspace";
import { StaffWorkspaceAccess } from "../../../_components/staff-workspace-access";

export function IngredientRequestReviewRoute() {
  return (
    <StaffWorkspaceAccess capability="review_ingredient_requests">
      {(onAuthorizationLost) => (
        <IngredientRequestReviewWorkspace
          onAuthorizationLost={onAuthorizationLost}
        />
      )}
    </StaffWorkspaceAccess>
  );
}
