import type { ReactNode } from "react";

import { WorkspaceEmptyState } from "./workspace-empty-state";

interface PaginationOutOfRangeProps {
  action: ReactNode;
  className?: string;
  description: string;
  eyebrow?: string;
  headingId: string;
  headingLevel?: 2 | 3;
  title: string;
}

export function PaginationOutOfRange({
  action,
  className,
  description,
  eyebrow = "Page out of range",
  headingId,
  headingLevel,
  title,
}: PaginationOutOfRangeProps) {
  return (
    <WorkspaceEmptyState
      action={action}
      className={className}
      description={description}
      eyebrow={eyebrow}
      headingId={headingId}
      headingLevel={headingLevel}
      title={title}
    />
  );
}
