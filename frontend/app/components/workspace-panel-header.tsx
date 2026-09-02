import type { ReactNode } from "react";

interface WorkspacePanelHeaderProps {
  className?: string;
  description: string;
  headingId?: string;
  meta?: ReactNode;
  title: string;
}

export function WorkspacePanelHeader({
  className,
  description,
  headingId,
  meta,
  title,
}: WorkspacePanelHeaderProps) {
  const classes = ["workspace-panel-header", className]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={classes}>
      <div className="workspace-panel-header__copy">
        <h2 id={headingId}>{title}</h2>
        <p>{description}</p>
      </div>
      {meta !== undefined && meta !== null ? (
        <div className="workspace-panel-header__meta">{meta}</div>
      ) : null}
    </header>
  );
}
