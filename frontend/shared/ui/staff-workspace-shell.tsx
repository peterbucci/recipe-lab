import type { ReactNode } from "react";

type StaffWorkspaceVariant = "curation" | "moderation";

interface StaffWorkspaceShellProps {
  children: ReactNode;
  className: string;
  description: string;
  headerAction?: ReactNode;
  headerClassName: string;
  title: string;
  variant: StaffWorkspaceVariant;
}

export function StaffWorkspaceShell({
  children,
  className,
  description,
  headerAction,
  headerClassName,
  title,
  variant,
}: StaffWorkspaceShellProps) {
  const copy = (
    <>
      <h1>{title}</h1>
      <p>{description}</p>
    </>
  );

  return (
    <main
      id="main-content"
      className={`page-shell staff-workspace staff-workspace--${variant} ${className}`}
    >
      <header className={`staff-workspace__header ${headerClassName}`}>
        {headerAction ? (
          <>
            <div className="staff-workspace__header-copy">{copy}</div>
            {headerAction}
          </>
        ) : (
          copy
        )}
      </header>
      {children}
    </main>
  );
}

interface StaffWorkspaceSplitPanelProps {
  children: ReactNode;
  className: string;
  detailClassName: string;
  detailHeadingId: string;
  queue: ReactNode;
}

export function StaffWorkspaceSplitPanel({
  children,
  className,
  detailClassName,
  detailHeadingId,
  queue,
}: StaffWorkspaceSplitPanelProps) {
  return (
    <div className={`staff-workspace__layout ${className}`}>
      {queue}
      <section
        className={`staff-panel-surface staff-workspace__detail ${detailClassName}`}
        aria-labelledby={detailHeadingId}
      >
        {children}
      </section>
    </div>
  );
}
