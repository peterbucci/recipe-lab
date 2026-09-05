import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
} from "react";
import { forwardRef } from "react";

import { LoadingStatus } from "./loading-status";

export type PageLoadingVariant =
  | "authoring"
  | "catalog"
  | "comparison"
  | "cook"
  | "member"
  | "recipe"
  | "settings"
  | "staff";

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

function RecipePageSkeleton({ comparison = false }: { comparison?: boolean }) {
  return (
    <div className="page-loading__recipe" aria-hidden="true">
      <div className="page-loading__recipe-hero">
        <LoadingBlock className="page-loading__recipe-artwork" />
        <div className="page-loading__recipe-intro">
          <LoadingBlock className="loading-block--pill" />
          <LoadingBlock className="loading-block--title" />
          <LoadingBlock className="loading-block--copy" />
          <LoadingBlock className="loading-block--copy loading-block--copy-short" />
          <div className="page-loading__facts">
            {Array.from({ length: 4 }, (_, index) => (
              <LoadingBlock key={index} />
            ))}
          </div>
          <div className="page-loading__actions">
            {Array.from({ length: 3 }, (_, index) => (
              <LoadingBlock key={index} />
            ))}
          </div>
        </div>
      </div>
      <div className="page-loading__recipe-tabs">
        {Array.from({ length: 3 }, (_, index) => (
          <LoadingBlock key={index} />
        ))}
      </div>
      <div
        className={`page-loading__recipe-body${
          comparison ? " page-loading__recipe-body--comparison" : ""
        }`}
      >
        <div>
          <LoadingBlock className="loading-block--heading" />
          {Array.from({ length: 5 }, (_, index) => (
            <LoadingBlock className="loading-block--row" key={index} />
          ))}
        </div>
        <div>
          <LoadingBlock className="loading-block--heading" />
          {Array.from({ length: 4 }, (_, index) => (
            <LoadingBlock className="loading-block--row" key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CatalogPageSkeleton() {
  return (
    <div className="page-loading__catalog" aria-hidden="true">
      <div className="page-loading__catalog-filters">
        <div className="page-loading__pills">
          {Array.from({ length: 6 }, (_, index) => (
            <LoadingBlock className="loading-block--pill" key={index} />
          ))}
        </div>
        <LoadingBlock className="page-loading__search" />
      </div>
      <div className="page-loading__heading-row">
        <h1>All recipes</h1>
        <LoadingBlock className="loading-block--small" />
      </div>
      <div className="page-loading__card-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="page-loading__card" key={index}>
            <LoadingBlock className="page-loading__card-artwork" />
            <div className="page-loading__card-body">
              <LoadingBlock className="loading-block--pill" />
              <LoadingBlock className="loading-block--heading" />
              <LoadingBlock className="loading-block--copy" />
              <LoadingBlock className="loading-block--small" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MemberPageSkeleton({ title }: { title?: string }) {
  return (
    <div className="page-loading__member" aria-hidden="true">
      <div className="page-loading__member-intro">
        <div>
          <LoadingBlock className="loading-block--eyebrow" />
          <h1>{title ?? "Your account"}</h1>
          <LoadingBlock className="loading-block--copy" />
        </div>
        <LoadingBlock className="loading-block--button" />
      </div>
      <div className="page-loading__member-frame">
        <div className="page-loading__member-tabs">
          {Array.from({ length: 4 }, (_, index) => (
            <LoadingBlock key={index} />
          ))}
        </div>
        <div className="page-loading__member-toolbar">
          <LoadingBlock className="loading-block--heading" />
          <LoadingBlock className="loading-block--small" />
        </div>
        <div className="page-loading__member-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="page-loading__member-card" key={index}>
              <LoadingBlock className="page-loading__member-artwork" />
              <div>
                <LoadingBlock className="loading-block--pill" />
                <LoadingBlock className="loading-block--heading" />
                <LoadingBlock className="loading-block--copy" />
                <LoadingBlock className="loading-block--button" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CookPageSkeleton() {
  return (
    <div className="page-loading__cook" aria-hidden="true">
      <div className="page-loading__cook-header">
        <LoadingBlock className="page-loading__avatar" />
        <div>
          <LoadingBlock className="loading-block--title" />
          <LoadingBlock className="loading-block--copy" />
        </div>
        <LoadingBlock className="loading-block--button" />
      </div>
      <div className="page-loading__card-grid page-loading__card-grid--four">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="page-loading__card" key={index}>
            <LoadingBlock className="page-loading__card-artwork" />
            <div className="page-loading__card-body">
              <LoadingBlock className="loading-block--heading" />
              <LoadingBlock className="loading-block--copy" />
              <LoadingBlock className="loading-block--small" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelPageSkeleton({ title }: { title?: string }) {
  return (
    <div className="page-loading__panel-page" aria-hidden="true">
      <div className="page-loading__panel-header">
        <div>
          <LoadingBlock className="loading-block--eyebrow" />
          <h1>{title ?? "Workspace"}</h1>
          <LoadingBlock className="loading-block--copy" />
        </div>
      </div>
      <div className="page-loading__panel-grid">
        <aside>
          {Array.from({ length: 5 }, (_, index) => (
            <LoadingBlock className="loading-block--row" key={index} />
          ))}
        </aside>
        <section>
          <LoadingBlock className="loading-block--heading" />
          <LoadingBlock className="loading-block--copy" />
          {Array.from({ length: 5 }, (_, index) => (
            <LoadingBlock className="loading-block--row" key={index} />
          ))}
        </section>
      </div>
    </div>
  );
}

function SettingsPageSkeleton({ title }: { title?: string }) {
  return (
    <div className="page-loading__settings" aria-hidden="true">
      <LoadingBlock className="loading-block--small" />
      <header className="page-loading__settings-intro">
        <LoadingBlock className="loading-block--eyebrow" />
        <h1>{title ?? "Settings"}</h1>
        <LoadingBlock className="loading-block--copy" />
      </header>
      <section className="page-loading__settings-panel">
        <LoadingBlock className="loading-block--eyebrow" />
        <LoadingBlock className="loading-block--heading" />
        <LoadingBlock className="loading-block--copy" />
        <LoadingBlock className="loading-block--copy" />
        <LoadingBlock className="loading-block--row" />
        <LoadingBlock className="loading-block--row" />
        <LoadingBlock className="loading-block--button" />
      </section>
    </div>
  );
}

interface PageLoadingSkeletonProps {
  className?: string;
  exitHref?: string;
  exitLabel?: string;
  label: string;
  title?: string;
  variant: PageLoadingVariant;
}

export function PageLoadingSkeleton({
  className = "",
  exitHref = "/recipes",
  exitLabel = "Browse recipes",
  label,
  title,
  variant,
}: PageLoadingSkeletonProps) {
  const detailVariant =
    variant === "authoring" ||
    variant === "comparison" ||
    variant === "recipe";
  return (
    <main
      id="main-content"
      className={`page-loading page-loading--${variant} ${className}`.trim()}
      aria-busy="true"
    >
      <LoadingStatus
        exitHref={exitHref}
        exitLabel={exitLabel}
        label={label}
      />
      {variant === "catalog" ? <CatalogPageSkeleton /> : null}
      {detailVariant ? (
        <RecipePageSkeleton comparison={variant === "comparison"} />
      ) : null}
      {variant === "cook" ? <CookPageSkeleton /> : null}
      {variant === "member" ? <MemberPageSkeleton title={title} /> : null}
      {variant === "staff" ? (
        <PanelPageSkeleton title={title} />
      ) : null}
      {variant === "settings" ? <SettingsPageSkeleton title={title} /> : null}
    </main>
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
