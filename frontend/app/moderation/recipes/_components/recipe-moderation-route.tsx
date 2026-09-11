"use client";

import { RecipeModerationWorkspace } from "../../../../features/moderation/review/recipe-moderation-workspace";
import { StaffWorkspaceAccess } from "../../../_components/staff-workspace-access";

export function RecipeModerationRoute() {
  return (
    <StaffWorkspaceAccess capability="moderate_recipe_reports">
      {(onAuthorizationLost) => (
        <RecipeModerationWorkspace onAuthorizationLost={onAuthorizationLost} />
      )}
    </StaffWorkspaceAccess>
  );
}
