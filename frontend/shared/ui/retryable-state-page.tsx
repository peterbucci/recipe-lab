"use client";

import type { ReactNode } from "react";

import { StatePage, StatePanel } from "./state-page";

interface RetryableStatePageProps {
  className?: string;
  description: string;
  eyebrow?: string;
  headingId: string;
  panelClassName?: string;
  retry: () => void;
  retryLabel?: string;
  secondaryAction?: ReactNode;
  title: string;
}

export function RetryableStatePage({
  className,
  description,
  eyebrow,
  headingId,
  panelClassName,
  retry,
  retryLabel = "Try again",
  secondaryAction,
  title,
}: RetryableStatePageProps) {
  return (
    <StatePage className={className}>
      <StatePanel
        actions={
          <>
            <button
              className="button button--primary"
              type="button"
              onClick={retry}
            >
              {retryLabel}
            </button>
            {secondaryAction}
          </>
        }
        alert
        className={["error-state", panelClassName].filter(Boolean).join(" ")}
        description={description}
        eyebrow={eyebrow}
        headingId={headingId}
        title={title}
      />
    </StatePage>
  );
}
