"use client";

import { useAuthSession } from "./auth-session-provider";
import { GuardedLink } from "../../shared/navigation/navigation-blocker-provider";

export function DemoSessionNotice() {
  const { state } = useAuthSession();
  if (state.phase !== "ready" || state.session.status === "anonymous" || !state.session.temporary) return null;
  return (
    <aside className="session-recovery" aria-label="Temporary demo session">
      <div className="session-recovery__inner">
        <p>Portfolio demo · Published work is public. No personal or sensitive information.
          {state.session.expires_at ? <> Session ends by <time dateTime={state.session.expires_at}>{new Date(state.session.expires_at).toUTCString()}</time>.</> : null}
          {" "}<GuardedLink href="/sign-in">Expiry and contact details</GuardedLink>
        </p>
      </div>
    </aside>
  );
}
