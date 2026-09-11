"use client";

import { MemberActivityTimeline } from "../../../../features/account/member-activity-timeline";
import { useAuthSession } from "../../../../features/auth/auth-session-provider";
import { MemberRouteGate } from "../../../../features/auth/member-route-gate";

export function AccountActivityRoute() {
  const { state } = useAuthSession();
  const userId =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session.user.id
      : null;

  return (
    <MemberRouteGate returnTo="/account/activity">
      {userId ? <MemberActivityTimeline key={userId} userId={userId} /> : null}
    </MemberRouteGate>
  );
}
