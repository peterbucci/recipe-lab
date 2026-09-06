import type { ReactNode } from "react";

import {
  SectionLoading,
  type SectionLoadingLayout,
} from "./loading-ui";

interface WorkspaceErrorStateProps {
  action?: ReactNode;
  className?: string;
  headingId?: string;
  headingLevel?: 2 | 3;
  message: string;
  title?: string;
}

export function WorkspaceErrorState({
  action,
  className,
  headingId,
  headingLevel = 3,
  message,
  title,
}: WorkspaceErrorStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <div
      className={["workspace-state", "workspace-state--error", className]
        .filter(Boolean)
        .join(" ")}
      role="alert"
    >
      {title ? <Heading id={headingId}>{title}</Heading> : null}
      <p>{message}</p>
      {action}
    </div>
  );
}

interface WorkspaceLoadingStateProps {
  className?: string;
  count?: number;
  label: string;
  layout?: SectionLoadingLayout;
  refreshing?: boolean;
}

export function WorkspaceLoadingState({
  className,
  ...props
}: WorkspaceLoadingStateProps) {
  return (
    <SectionLoading
      {...props}
      className={["workspace-state", "workspace-state--loading", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
