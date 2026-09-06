import { LoadingStatus } from "./loading-status";
import { LoadingBlock } from "./loading-ui";

export type PageLoadingVariant =
  | "authoring"
  | "catalog"
  | "comparison"
  | "cook"
  | "member"
  | "recipe"
  | "settings"
  | "staff";

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

