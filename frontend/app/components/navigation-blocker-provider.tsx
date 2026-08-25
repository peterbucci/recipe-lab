"use client";

import Link from "next/link";
import {
  createContext,
  type ComponentProps,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const LEAVE_WARNING = "You have unsaved recipe changes. Leave without saving them?";

interface NavigationBlockerContextValue {
  blocked: boolean;
  confirmNavigation: () => boolean;
  setBlocked: (blocked: boolean) => void;
}

const NavigationBlockerContext = createContext<NavigationBlockerContextValue>({
  blocked: false,
  confirmNavigation: () => true,
  setBlocked: () => undefined,
});

export function NavigationBlockerProvider({ children }: { children: ReactNode }) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!blocked) {
      return;
    }

    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [blocked]);

  useEffect(() => {
    if (!blocked) return;

    // popstate cannot be cancelled. Add a same-URL sentinel so Back first lands
    // on an inert history entry where we can ask before the actual navigation.
    const marker = `recipe-draft-${crypto.randomUUID()}`;
    const previousState = window.history.state as unknown;
    const state =
      typeof previousState === "object" && previousState !== null
        ? { ...previousState, __recipeDraftGuard: marker }
        : { __recipeDraftGuard: marker };
    window.history.pushState(state, "", window.location.href);
    let restoringSentinel = false;

    function handleHistoryNavigation() {
      if (restoringSentinel) {
        restoringSentinel = false;
        return;
      }
      if (!window.confirm(LEAVE_WARNING)) {
        restoringSentinel = true;
        window.history.forward();
        return;
      }
      setBlocked(false);
      window.setTimeout(() => window.history.back(), 0);
    }

    window.addEventListener("popstate", handleHistoryNavigation);
    return () => {
      window.removeEventListener("popstate", handleHistoryNavigation);
      const current = window.history.state as Record<string, unknown> | null;
      if (current?.__recipeDraftGuard === marker) {
        // The duplicate same-URL entry is harmless after saving. Strip the
        // marker so it can never prompt after the editor is clean.
        window.history.replaceState(previousState, "", window.location.href);
      }
    };
  }, [blocked]);

  const confirmNavigation = useCallback(
    () => !blocked || window.confirm(LEAVE_WARNING),
    [blocked],
  );

  const value = useMemo(
    () => ({ blocked, confirmNavigation, setBlocked }),
    [blocked, confirmNavigation],
  );

  return (
    <NavigationBlockerContext.Provider value={value}>
      {children}
    </NavigationBlockerContext.Provider>
  );
}

export function useNavigationBlocker(): NavigationBlockerContextValue {
  return useContext(NavigationBlockerContext);
}

export function GuardedLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const { confirmNavigation } = useNavigationBlocker();

  return (
    <Link
      {...props}
      onNavigate={(event) => {
        onNavigate?.(event);
        if (!confirmNavigation()) {
          event.preventDefault();
        }
      }}
    />
  );
}
