import type { ReactNode } from "react";

interface StatePageProps {
  children: ReactNode;
  className?: string;
}

export function StatePage({ children, className }: StatePageProps) {
  return (
    <main
      id="main-content"
      className={["state-page", className].filter(Boolean).join(" ")}
    >
      {children}
    </main>
  );
}

interface StatePanelProps {
  actions?: ReactNode;
  actionsClassName?: string;
  alert?: boolean;
  className?: string;
  description: string;
  descriptionClassName?: string;
  eyebrow?: string;
  headingId: string;
  title: string;
}

export function StatePanel({
  actions,
  actionsClassName,
  alert = false,
  className,
  description,
  descriptionClassName,
  eyebrow,
  headingId,
  title,
}: StatePanelProps) {
  const descriptionId = `${headingId}-description`;

  return (
    <section
      className={["state-panel", className].filter(Boolean).join(" ")}
      role={alert ? "alert" : undefined}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 id={headingId}>{title}</h1>
      <p className={descriptionClassName} id={descriptionId}>
        {description}
      </p>
      {actions ? (
        <div
          className={["state-panel__actions", "button-row", actionsClassName]
            .filter(Boolean)
            .join(" ")}
        >
          {actions}
        </div>
      ) : null}
    </section>
  );
}
