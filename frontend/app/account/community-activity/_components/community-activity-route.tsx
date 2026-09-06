"use client";

import { useAuthSession } from "../../../../features/auth/auth-session-provider";
import { MemberRouteGate } from "../../../../features/auth/member-route-gate";
import { CommunityActivityTimeline } from "../../../../features/community/community-activity-timeline";

export function CommunityActivityRoute() {
  const { state } = useAuthSession();
  const userId =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session.user.id
      : null;

  return (
    <MemberRouteGate
      anonymousHeading="Sign in to see your community activity"
      anonymousMessage="Follow cooks and keep up with the recipes and versions they publish."
      eyebrow="Your community"
      returnTo="/account/community-activity"
      title="Community activity"
    >
      {userId ? (
        <CommunityActivityTimeline key={userId} userId={userId} />
      ) : null}
    </MemberRouteGate>
  );
}
