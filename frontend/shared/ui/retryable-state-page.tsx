"use client";

import type { ReactNode } from "react";

import { StatePage, StatePanel } from "./state-page";

interface RetryableStatePageProps {
  actionsClassName?: string;
  className?: string;
  description: string;
  descriptionClassName?: string;
  eyebrow?: string;
  headingId: string;
  panelClassName?: string;
  retry: () => void;
  retryLabel?: string;
  secondaryAction?: ReactNode;
  title: string;
}

export function RetryableStatePage({
  actionsClassName,
  className,
  description,
  descriptionClassName,
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
        actionsClassName={actionsClassName}
        alert
        className={panelClassName}
        description={description}
        descriptionClassName={descriptionClassName}
        eyebrow={eyebrow}
        headingId={headingId}
        title={title}
      />
    </StatePage>
  );
}
