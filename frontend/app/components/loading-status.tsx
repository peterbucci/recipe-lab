"use client";

import { useEffect, useState } from "react";

interface LoadingStatusProps {
  delayMs?: number;
  exitHref?: string;
  exitLabel?: string;
  label: string;
  longWaitMessage?: string;
}

export function LoadingStatus({
  delayMs = 8_000,
  exitHref,
  exitLabel = "Return to recipes",
  label,
  longWaitMessage = "This is taking longer than usual. You can keep waiting or leave safely.",
}: LoadingStatusProps) {
  const [longWait, setLongWait] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setLongWait(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs]);

  return (
    <>
      <p className="visually-hidden" role="status">
        {longWait ? `${label} ${longWaitMessage}` : label}
      </p>
      {longWait ? (
        <div className="loading-long-wait">
          <p>{longWaitMessage}</p>
          {exitHref ? (
            <a className="button button--quiet" href={exitHref}>
              {exitLabel}
            </a>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
