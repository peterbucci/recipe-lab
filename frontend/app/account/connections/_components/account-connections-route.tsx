"use client";

import { useAuthSession } from "../../../../features/auth/auth-session-provider";
import { MemberRouteGate } from "../../../../features/auth/member-route-gate";
import {
  connectionsHref,
  type MemberConnectionsView,
} from "../../../../features/community/member-connections-route";
import { MemberConnectionsWorkspace } from "../../../../features/community/member-connections-workspace";

interface AccountConnectionsRouteProps {
  pageNumber: number;
  view: MemberConnectionsView;
}

export function AccountConnectionsRoute({
  pageNumber,
  view,
}: AccountConnectionsRouteProps) {
  const { state } = useAuthSession();
  const userId =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session.user.id
      : null;

  return (
    <MemberRouteGate returnTo={connectionsHref(view, pageNumber)}>
      {userId ? (
        <MemberConnectionsWorkspace
          key={`${userId}:${view}:${pageNumber}`}
          pageNumber={pageNumber}
          userId={userId}
          view={view}
        />
      ) : null}
    </MemberRouteGate>
  );
}
