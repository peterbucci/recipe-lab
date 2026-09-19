"use client";

import { useEffect, useState } from "react";

import {
  fetchDemoAvailability,
  type DemoAvailability,
} from "./auth-api";
import { useAuthSession } from "./auth-session-provider";
import { DemoSandboxInformation } from "./demo-sandbox-information";
import { GuardedLink } from "../../shared/navigation/navigation-blocker-provider";

export function DemoSessionDetails() {
  const { state } = useAuthSession();
  const [availability, setAvailability] = useState<DemoAvailability | null>(
    null,
  );
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const session =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session
      : null;
  const temporary = session?.temporary === true;

  useEffect(() => {
    if (!temporary) return;
    const controller = new AbortController();
    void fetchDemoAvailability(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setAvailability(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("We couldn’t load the current demo details. Please retry.");
        }
      });
    return () => controller.abort();
  }, [attempt, temporary]);

  return (
    <section
      className="demo-session-details"
      aria-labelledby="demo-session-information-title"
    >
      <header className="demo-session-details__header">
        <h2 id="demo-session-information-title">
          {temporary
            ? "About your demo account"
            : "About demo accounts"}
        </h2>
      </header>

      <div className="demo-session-details__body">
        {!temporary ? (
          <p>
            Your current account is not a demo account. These details apply
            only when Recipe Lab is running as a portfolio sandbox.
          </p>
        ) : availability?.enabled ? (
          <DemoSandboxInformation
            contactUrl={availability.contact_url!}
            expiresAt={session?.expires_at ?? availability.expires_at!}
            variant="details"
          />
        ) : error ? (
          <div className="demo-session-details__state">
            <p role="alert">{error}</p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => {
                setAvailability(null);
                setError("");
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : availability ? (
          <p role="status">
            This portfolio sandbox is no longer accepting temporary sessions.
          </p>
        ) : (
          <p role="status">Loading demo details…</p>
        )}
      </div>

      <div className="auth-card__actions sign-in-card__actions demo-session-details__actions">
        <GuardedLink className="button button--primary" href="/">
          Return to Recipe Lab
        </GuardedLink>
      </div>
    </section>
  );
}
