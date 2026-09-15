"use client";

import { useAuthSession } from "../../../../features/auth/auth-session-provider";
import { MemberRouteGate } from "../../../../features/auth/member-route-gate";
import { CommunityActivityTimeline } from "../../../../features/community/community-activity-timeline";
import { ordinaryRecipePath } from "../../../../features/recipes/shared/recipe-paths";

export function CommunityActivityRoute() {
  const { state } = useAuthSession();
  const userId =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session.user.id
      : null;

  return (
    <MemberRouteGate
      returnTo="/account/community-activity"
      signedOutDescription="Follow cooks and keep up with the recipes and versions they publish."
    >
      {userId ? (
        <CommunityActivityTimeline
          key={userId}
          recipeHref={ordinaryRecipePath}
          userId={userId}
        />
      ) : null}
    </MemberRouteGate>
  );
}
