"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { AuthApiError, fetchDemoAvailability, safeReturnTo, signInHref, type DemoAvailability } from "./auth-api";
import { useAuthSession } from "./auth-session-provider";
import { GuardedLink, useNavigationBlocker } from "../../shared/navigation/navigation-blocker-provider";
import { LoadingButton } from "../../shared/ui/loading-ui";

export function SignInAccess({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const { state, enterDemo } = useAuthSession();
  const { confirmNavigation } = useNavigationBlocker();
  const [availability, setAvailability] = useState<DemoAvailability | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const entryController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchDemoAvailability(controller.signal).then((value) => {
      if (!controller.signal.aborted) setAvailability(value);
    }).catch(() => {
      if (!controller.signal.aborted) setError("We couldn’t check sign-in availability. Please retry.");
    });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => () => entryController.current?.abort(), []);

  async function startDemo() {
    if (entryController.current || !availability?.generation_id || !confirmNavigation()) return;
    const controller = new AbortController();
    entryController.current = controller;
    setPending(true);
    setError("");
    try {
      const session = await enterDemo(availability.generation_id, controller.signal);
      if (session && !controller.signal.aborted) {
        router.replace(safeReturnTo(returnTo));
        router.refresh();
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof AuthApiError
        ? reason.message : "We couldn’t confirm demo entry. Retry to check before starting another session.");
    } finally {
      if (!controller.signal.aborted) setPending(false);
      entryController.current = null;
    }
  }

  return (
    <>
      {availability?.enabled ? (
        <div className="auth-card__fine-print">
          <p><strong>Public portfolio sandbox.</strong> Try publishing, revising, forking, saving, rating, and following with your own temporary identity. No email or real name needed.</p>
          <p>Published recipes and profiles are public. Don’t enter personal or sensitive information. No uploads. Demo activity is not used for advertising, profiling, or ML training.</p>
          <p>All demo work is temporary and this environment closes by <time dateTime={availability.expires_at!}>{new Date(availability.expires_at!).toUTCString()}</time> (at most 24 hours). It may reset sooner. Signing out ends access to this identity; starting fresh does not restore earlier work.</p>
          <p><a href={availability.contact_url!} rel="noreferrer">Contact the operator about demo data</a>. Don’t include private information in a public report.</p>
        </div>
      ) : null}
      <div className="auth-card__actions sign-in-card__actions">
        {!availability && !error ? <p role="status">Checking sign-in options…</p> : null}
        {availability?.enabled ? (
          <LoadingButton className="button button--primary" type="button" pending={pending}
            pendingLabel="Starting demo…" disabled={state.phase === "loading"}
            onClick={() => void startDemo()}>
            {state.phase === "ready" && state.session.status !== "anonymous" ? "Continue to the app" : "Try the demo"}
          </LoadingButton>
        ) : availability ? (
          <a aria-label="Continue to sign in" className="button button--primary" href={signInHref(returnTo)}>
            <span aria-hidden="true">Continue to secure sign in</span><span aria-hidden="true">→</span>
          </a>
        ) : error ? (
          <button className="button button--primary" type="button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Retry sign-in options</button>
        ) : null}
        <GuardedLink className="button button--secondary" href="/recipes">Keep browsing</GuardedLink>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {availability && !availability.enabled ? (
        <div className="auth-card__fine-print sign-in-security-note">
          <span className="sign-in-security-note__icon" aria-hidden="true">✓</span>
          <p><strong>Recipe Lab doesn&apos;t collect your password on this page.</strong>{" "}
            Sign-in is handled by our secure identity provider, and you&apos;ll return to Recipe Lab when you&apos;re done.</p>
        </div>
      ) : null}
    </>
  );
}
