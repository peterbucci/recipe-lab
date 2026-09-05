import type { ReactNode } from "react";

interface WorkspaceEmptyStateProps {
  action?: ReactNode;
  className?: string;
  description: string;
  eyebrow?: string;
  headingId: string;
  headingLevel?: 2 | 3;
  title: string;
}

export function WorkspaceEmptyState({
  action,
  className,
  description,
  eyebrow = "Nothing here yet",
  headingId,
  headingLevel = 2,
  title,
}: WorkspaceEmptyStateProps) {
  const classes = ["empty-state", "workspace-empty-state", className]
    .filter(Boolean)
    .join(" ");
  const descriptionId = `${headingId}-description`;
  const Heading = headingLevel === 3 ? "h3" : "h2";

  return (
    <section
      className={classes}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <div className="workspace-empty-state__body">
        <p className="eyebrow workspace-empty-state__eyebrow">{eyebrow}</p>
        <Heading id={headingId}>{title}</Heading>
        <p id={descriptionId} className="workspace-empty-state__description">
          {description}
        </p>
        {action ? <div className="workspace-empty-state__action">{action}</div> : null}
      </div>
    </section>
  );
}
