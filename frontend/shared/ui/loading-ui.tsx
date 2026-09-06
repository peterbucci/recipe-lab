import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";
import { forwardRef } from "react";

import { LoadingStatus } from "./loading-status";

interface LoadingBlockProps extends HTMLAttributes<HTMLSpanElement> {
  className?: string;
}

export function LoadingBlock({ className = "", ...props }: LoadingBlockProps) {
  return (
    <span
      {...props}
      aria-hidden="true"
      className={`loading-block ${className}`.trim()}
    />
  );
}

interface AuthGateLoadingProps {
  className?: string;
  exitHref?: string;
  label?: string;
}

export function AuthGateLoading({
  className = "",
  exitHref = "/recipes",
  label = "Checking your account…",
}: AuthGateLoadingProps) {
  return (
    <section
      className={`auth-gate-loading ${className}`.trim()}
      aria-busy="true"
    >
      <LoadingStatus exitHref={exitHref} label={label} />
      <div className="auth-gate-loading__identity" aria-hidden="true">
        <LoadingBlock className="auth-gate-loading__avatar" />
        <span>
          <LoadingBlock className="auth-gate-loading__name" />
          <LoadingBlock className="auth-gate-loading__detail" />
        </span>
      </div>
      <LoadingBlock className="auth-gate-loading__action" />
    </section>
  );
}

export type SectionLoadingLayout = "cards" | "panel" | "rows" | "summary";

interface SectionLoadingProps {
  className?: string;
  count?: number;
  label: string;
  layout?: SectionLoadingLayout;
  refreshing?: boolean;
}

export function SectionLoading({
  className = "",
  count = 3,
  label,
  layout = "rows",
  refreshing = false,
}: SectionLoadingProps) {
  if (refreshing) {
    return (
      <div
        className={`section-loading section-loading--refreshing ${className}`.trim()}
        aria-busy="true"
      >
        <InlineLoading label={label} />
      </div>
    );
  }
  return (
    <div
      className={`section-loading section-loading--${layout} ${className}`.trim()}
      aria-busy="true"
    >
      <LoadingStatus label={label} />
      <div className="section-loading__items" aria-hidden="true">
        {Array.from({ length: count }, (_, index) => (
          <div className="section-loading__item" key={index}>
            {layout === "cards" ? (
              <LoadingBlock className="section-loading__artwork" />
            ) : null}
            {layout === "summary" ? (
              <LoadingBlock className="section-loading__avatar" />
            ) : null}
            <span className="section-loading__item-copy">
              <LoadingBlock className="loading-block--heading" />
              <LoadingBlock className="loading-block--copy" />
              {layout === "panel" ? (
                <LoadingBlock className="loading-block--row" />
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface InlineLoadingProps {
  className?: string;
  label: string;
  visuallyHidden?: boolean;
}

export function InlineLoading({
  className = "",
  label,
  visuallyHidden = false,
}: InlineLoadingProps) {
  return (
    <span className={`inline-loading ${className}`.trim()} role="status">
      <span className="loading-spinner" aria-hidden="true" />
      <span className={visuallyHidden ? "visually-hidden" : undefined}>
        {label}
      </span>
    </span>
  );
}

interface LoadingButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  compact?: boolean;
  pending?: boolean;
  pendingLabel: string;
}

export const LoadingButton = forwardRef<HTMLButtonElement, LoadingButtonProps>(
  function LoadingButton(
    {
      children,
      className = "",
      compact = false,
      disabled,
      pending = false,
      pendingLabel,
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        className={`loading-button${compact ? " loading-button--compact" : ""} ${className}`.trim()}
        disabled={disabled || pending}
        aria-busy={pending}
      >
        <span className="loading-button__stack">
          <span
            className="loading-button__idle"
            aria-hidden={pending ? "true" : undefined}
          >
            {children}
          </span>
          <span
            className="loading-button__pending"
            aria-hidden={pending ? undefined : "true"}
          >
            <span className="loading-spinner" aria-hidden="true" />
            <span className={compact ? "visually-hidden" : undefined}>
              {pendingLabel}
            </span>
          </span>
        </span>
      </button>
    );
  },
);
