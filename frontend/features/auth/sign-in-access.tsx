"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { AuthApiError, fetchDemoAvailability, safeReturnTo, signInHref, type DemoAvailability } from "./auth-api";
import { useAuthSession } from "./auth-session-provider";
import { DemoSandboxInformation } from "./demo-sandbox-information";
import { GuardedLink, useNavigationBlocker } from "../../shared/navigation/navigation-blocker-provider";
import { LoadingButton } from "../../shared/ui/loading-ui";

interface SignInAccessProps {
  artwork: ReactNode;
  returnTo: string;
}

export function SignInAccess({ artwork, returnTo }: SignInAccessProps) {
  const router = useRouter();
  const { state, enterDemo } = useAuthSession();
  const { confirmNavigation } = useNavigationBlocker();
  const [availability, setAvailability] = useState<DemoAvailability | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const entryController = useRef<AbortController | null>(null);
  const authenticated = state.phase === "ready" && state.session.status !== "anonymous";
  const showAnonymousChrome = state.phase !== "loading" && !authenticated;
  const demoEnabled = availability?.enabled === true;

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
      <aside
        className="sign-in-visual"
        aria-label={demoEnabled ? "About the Recipe Lab demo" : "Why sign in"}
      >
        {artwork}
        <div className="sign-in-visual__copy">
          <strong>
            {demoEnabled
              ? "Explore Recipe Lab for yourself."
              : "Your recipes, saved for later."}
          </strong>
          <p>
            {demoEnabled
              ? "Save recipes, create your own versions, publish, and come back to your work while your demo account is active."
              : "Sign in when you want to save, adapt, publish, or come back to something you're cooking."}
          </p>
        </div>
      </aside>

      <div className="sign-in-card__content">
        {showAnonymousChrome ? (
          <h1>{demoEnabled ? "Try Recipe Lab" : "Sign in to Recipe Lab"}</h1>
        ) : null}
        {availability?.enabled ? (
          <div className="auth-card__fine-print">
            <DemoSandboxInformation
              contactUrl={availability.contact_url!}
              expiresAt={availability.expires_at!}
              variant="entry"
            />
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="auth-card__actions sign-in-card__actions">
          {!availability && !error ? <p role="status">Checking sign-in options…</p> : null}
          {availability?.enabled ? (
            <LoadingButton className="button button--primary" type="button" pending={pending}
              pendingLabel="Starting demo…" disabled={state.phase === "loading"}
              onClick={() => void startDemo()}>
              {state.phase === "ready" && state.session.status !== "anonymous" ? "Continue to the app" : "Start the demo"}
            </LoadingButton>
          ) : availability && authenticated ? (
            <GuardedLink className="button button--primary" href={safeReturnTo(returnTo)}>Continue to the app</GuardedLink>
          ) : availability ? (
            <a aria-label="Continue to sign in" className="button button--primary" href={signInHref(returnTo)}>
              <span aria-hidden="true">Continue to secure sign in</span><span aria-hidden="true">→</span>
            </a>
          ) : error ? (
            <button className="button button--primary" type="button" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Retry sign-in options</button>
          ) : null}
          {showAnonymousChrome ? <GuardedLink className="button button--secondary" href="/recipes">Keep browsing</GuardedLink> : null}
        </div>
        {availability && !availability.enabled ? (
          <div className="auth-card__fine-print sign-in-security-note">
            <span className="sign-in-security-note__icon" aria-hidden="true">✓</span>
            <p><strong>Recipe Lab doesn&apos;t collect your password on this page.</strong>{" "}
              Sign-in is handled by our secure identity provider, and you&apos;ll return to Recipe Lab when you&apos;re done.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
