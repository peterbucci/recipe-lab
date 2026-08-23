"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  refreshSession: () => Promise<AuthSession | null>;
  replaceSession: (session: AuthSession) => void;
}

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

  const replaceSession = useCallback((session: AuthSession) => {
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
      setState({ phase: "ready", session: { status: "anonymous" } });
      setSessionExpired(true);
    }

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, []);

  const value = useMemo(
    () => ({ state, sessionExpired, refreshSession, replaceSession }),
    [refreshSession, replaceSession, sessionExpired, state],
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
  const { sessionExpired } = useAuthSession();

  if (!sessionExpired) {
    return null;
  }

  return (
    <aside className="session-recovery" role="alert" aria-label="Session expired">
      <div className="session-recovery__inner">
        <span>Your session expired.</span>
        <a href="/sign-in?return_to=%2Frecipes">Sign in again</a>
      </div>
    </aside>
  );
}
