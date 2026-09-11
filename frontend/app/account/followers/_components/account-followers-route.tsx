"use client";

import { useAuthSession } from "../../../../features/auth/auth-session-provider";
import { MemberRouteGate } from "../../../../features/auth/member-route-gate";
import { MemberFollowersList } from "../../../../features/community/member-followers-list";

const RETURN_TO = "/account/followers";

export function AccountFollowersRoute() {
  const { state } = useAuthSession();
  const userId =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session.user.id
      : null;

  return (
    <MemberRouteGate returnTo={RETURN_TO}>
      {userId ? <MemberFollowersList key={userId} userId={userId} /> : null}
    </MemberRouteGate>
  );
}
