"use client";

import { useAuthSession } from "./auth-session-provider";
import { formatDemoExpiry } from "./demo-sandbox-information";
import { DEMO_SESSION_DETAILS_PATH } from "./demo-session-route";
import { GuardedLink } from "../../shared/navigation/navigation-blocker-provider";

export function DemoSessionNotice() {
  const { state } = useAuthSession();
  if (state.phase !== "ready" || state.session.status === "anonymous" || !state.session.temporary) return null;
  return (
    <aside
      className="session-recovery session-recovery--demo"
      aria-label="Demo account notice"
    >
      <div className="session-recovery__inner">
        <p>Demo account · Published work is public · Don’t enter personal or sensitive information
          {state.session.expires_at ? <> · Resets by <time dateTime={state.session.expires_at}>{formatDemoExpiry(state.session.expires_at)}</time></> : null}
          {" · "}<GuardedLink href={DEMO_SESSION_DETAILS_PATH}>View details</GuardedLink>
        </p>
      </div>
    </aside>
  );
}
