"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { LoadingButton } from "./loading-ui";

type RetryHomeLoad = () => Promise<unknown> | void;

interface HomeLoadStateContextValue {
  issueCount: number;
  registerIssue: (id: string, retry: RetryHomeLoad) => () => void;
  retryAll: () => void;
  retrying: boolean;
}

const HomeLoadStateContext = createContext<HomeLoadStateContextValue | null>(
  null,
);

export function HomeLoadStateProvider({ children }: { children: ReactNode }) {
  const retriesRef = useRef(new Map<string, RetryHomeLoad>());
  const [issueCount, setIssueCount] = useState(0);
  const [retrying, startRetry] = useTransition();

  const registerIssue = useCallback(
    (id: string, retry: RetryHomeLoad): (() => void) => {
      retriesRef.current.set(id, retry);
      setIssueCount(retriesRef.current.size);

      return () => {
        if (retriesRef.current.get(id) !== retry) return;
        retriesRef.current.delete(id);
        setIssueCount(retriesRef.current.size);
      };
    },
    [],
  );

  const retryAll = useCallback(() => {
    const retries = [...new Set(retriesRef.current.values())];
    startRetry(() => {
      for (const retry of retries) void retry();
    });
  }, []);

  return (
    <HomeLoadStateContext.Provider
      value={{ issueCount, registerIssue, retryAll, retrying }}
    >
      {children}
    </HomeLoadStateContext.Provider>
  );
}

export function useHomeLoadIssue({
  active,
  id,
  retry,
}: {
  active: boolean;
  id: string;
  retry: RetryHomeLoad;
}) {
  const context = useContext(HomeLoadStateContext);
  const registerIssue = context?.registerIssue;
  const retryRef = useRef(retry);

  useEffect(() => {
    retryRef.current = retry;
  }, [retry]);

  useEffect(() => {
    if (!active || !registerIssue) return;
    return registerIssue(id, () => retryRef.current());
  }, [active, id, registerIssue]);
}

export function HomeLoadNotice() {
  const context = useContext(HomeLoadStateContext);
  if (!context || context.issueCount === 0) return null;

  return (
    <section
      aria-labelledby="home-load-notice-title"
      aria-live="polite"
      className="home-load-notice"
      role="status"
    >
      <div>
        <strong id="home-load-notice-title">
          Some homepage information couldn’t be updated.
        </strong>
        <p>The rest of the page is still available.</p>
      </div>
      <LoadingButton
        className="button button--secondary"
        pending={context.retrying}
        pendingLabel="Trying again…"
        onClick={context.retryAll}
        type="button"
      >
        Try again
      </LoadingButton>
    </section>
  );
}

export function HomePublicFailureReporter({ failed }: { failed: boolean }) {
  const router = useRouter();
  const retry = useCallback(() => router.refresh(), [router]);
  useHomeLoadIssue({ active: failed, id: "public-discovery", retry });
  return null;
}
