"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AUTH_SESSION_EXPIRED_EVENT,
  type AuthSession,
  fetchAuthSession,
} from "../../lib/auth-api";

export type AuthSessionState =
  | { phase: "loading" }
  | { phase: "ready"; session: AuthSession }
  | { phase: "error" };

interface AuthSessionContextValue {
  state: AuthSessionState;
  sessionExpired: boolean;
  recoverSession: () => Promise<SessionRecoveryResult>;
  refreshSession: () => Promise<AuthSession | null>;
  replaceSession: (session: AuthSession) => void;
}

type SessionRecoveryResult =
  | "different_account"
  | "not_authenticated"
  | "restored"
  | "unavailable";

interface AuthSessionProviderProps {
  children: ReactNode;
  initialSession?: AuthSession;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({
  children,
  initialSession,
}: AuthSessionProviderProps) {
  const [state, setState] = useState<AuthSessionState>(() =>
    initialSession === undefined
      ? { phase: "loading" }
      : { phase: "ready", session: initialSession },
  );
  const [sessionExpired, setSessionExpired] = useState(false);
  const activeAuthenticatedUserIdRef = useRef(
    initialSession?.status === "authenticated" ? initialSession.user.id : null,
  );
  const interruptedUserIdRef = useRef<string | null>(null);

  const replaceSession = useCallback((session: AuthSession) => {
    activeAuthenticatedUserIdRef.current =
      session.status === "authenticated" ? session.user.id : null;
    interruptedUserIdRef.current = null;
    setState({ phase: "ready", session });
    setSessionExpired(false);
  }, []);

  const refreshSession = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const session = await fetchAuthSession();
      replaceSession(session);
      return session;
    } catch {
      setState({ phase: "error" });
      return null;
    }
  }, [replaceSession]);

  const recoverSession = useCallback(async () => {
    try {
      const session = await fetchAuthSession();
      if (session.status === "authenticated") {
        if (
          interruptedUserIdRef.current === null ||
          session.user.id !== interruptedUserIdRef.current
        ) {
          return "different_account";
        }
        replaceSession(session);
        return "restored";
      }
      // An anonymous or incomplete result means sign-in was canceled or is
      // unfinished. Keep the last authenticated UI state and interruption in
      // place; backend authorization still protects every private request.
      return "not_authenticated";
    } catch {
      // Recovery checks are intentionally non-destructive. The existing
      // interrupted state and local editor values remain in place.
      return "unavailable";
    }
  }, [replaceSession]);

  useEffect(() => {
    if (initialSession !== undefined) {
      return;
    }

    const controller = new AbortController();
    void fetchAuthSession(controller.signal)
      .then(replaceSession)
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setState({ phase: "error" });
        }
      });
    return () => controller.abort();
  }, [initialSession, replaceSession]);

  useEffect(() => {
    function handleSessionExpired() {
      // Retain the last authenticated UI state so an editor is never unmounted
      // with unsaved values. The interruption flag pauses recovery-sensitive
      // actions while the API continues enforcing the real session boundary.
      interruptedUserIdRef.current ??= activeAuthenticatedUserIdRef.current;
      setSessionExpired(true);
    }

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const value = useMemo(
    () => ({ state, sessionExpired, recoverSession, refreshSession, replaceSession }),
    [recoverSession, refreshSession, replaceSession, sessionExpired, state],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider.");
  }
  return context;
}

export function SessionRecoveryNotice() {
  const pathname = usePathname();
  const { recoverSession, sessionExpired } = useAuthSession();
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [message, setMessage] = useState(
    "Open sign-in in a new tab. This page will keep your unsaved work.",
  );
  const checkingRef = useRef(false);
  const noticeRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const recoveryStartedRef = useRef(false);
  const wasExpiredRef = useRef(false);

  const restorePreviousFocus = useCallback(() => {
    const previous = previousFocusRef.current;
    if (previous?.isConnected) {
      previous.focus();
    }
  }, []);

  const checkRecovery = useCallback(async () => {
    if (checkingRef.current) {
      return;
    }
    checkingRef.current = true;
    setChecking(true);
    setMessage("Checking whether sign-in finished…");
    const result = await recoverSession();
    checkingRef.current = false;
    setChecking(false);
    if (result === "restored") {
      recoveryStartedRef.current = false;
      setMessage("Sign-in restored. Your work is still here.");
      return;
    }
    setMessage(
      result === "different_account"
        ? "A different account is signed in. Sign back in as the account that owns this work."
        : result === "unavailable"
          ? "We couldn’t confirm sign-in yet. Your work is still here."
          : "Sign-in is not complete. Your work is still here.",
    );
    window.setTimeout(() => noticeRef.current?.focus(), 0);
  }, [recoverSession]);

  useEffect(() => {
    if (sessionExpired && !wasExpiredRef.current) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDismissed(false);
      setMessage("Open sign-in in a new tab. This page will keep your unsaved work.");
      window.setTimeout(() => noticeRef.current?.focus(), 0);
    } else if (!sessionExpired && wasExpiredRef.current) {
      recoveryStartedRef.current = false;
      window.setTimeout(restorePreviousFocus, 0);
    }
    wasExpiredRef.current = sessionExpired;
  }, [restorePreviousFocus, sessionExpired]);

  useEffect(() => {
    if (!sessionExpired) {
      return;
    }
    function handleWindowFocus() {
      if (recoveryStartedRef.current) {
        void checkRecovery();
      }
    }
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [checkRecovery, sessionExpired]);

  if (!sessionExpired) {
    return null;
  }

  const returnTo = pathname || "/recipes";
  const signInHref = `/sign-in?${new URLSearchParams({ return_to: returnTo }).toString()}`;

  if (dismissed) {
    return (
      <aside className="session-recovery" role="status" aria-label="Sign-in paused">
        <div className="session-recovery__inner">
          <span>Sign-in is still required before saving. Your work remains in this tab.</span>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setDismissed(false);
              window.setTimeout(() => noticeRef.current?.focus(), 0);
            }}
          >
            Resume sign-in
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={noticeRef}
      className="session-recovery"
      role="alert"
      aria-labelledby="session-recovery-title"
      tabIndex={-1}
    >
      <div className="session-recovery__inner">
        <div className="session-recovery__copy">
          <strong id="session-recovery-title">Your session expired. Your work is still here.</strong>
          <span>{message}</span>
        </div>
        <div className="session-recovery__actions">
          <a
            className="button button--primary"
            href={signInHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              recoveryStartedRef.current = true;
              setMessage("Finish signing in in the new tab, then return here.");
            }}
          >
            Sign in in a new tab
          </a>
          <button
            className="button button--secondary"
            type="button"
            disabled={checking}
            onClick={() => void checkRecovery()}
          >
            {checking ? "Checking sign-in…" : "Check sign-in"}
          </button>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => {
              recoveryStartedRef.current = false;
              setDismissed(true);
              window.setTimeout(restorePreviousFocus, 0);
            }}
          >
            Keep editing for now
          </button>
        </div>
      </div>
    </aside>
  );
}
