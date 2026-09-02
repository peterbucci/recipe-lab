import type { ReactNode } from "react";

export interface WorkspacePaginationControl {
  className: string;
  disabled: boolean;
  direction: "next" | "previous";
  label: string;
  page: number;
}

interface WorkspacePaginationProps {
  buttonClassName?: string;
  className?: string;
  currentPage: number;
  label: string;
  loading?: boolean;
  nextLabel?: string;
  onPageChange?: (page: number) => void;
  previousLabel?: string;
  renderControl?: (control: WorkspacePaginationControl) => ReactNode;
  totalPages: number;
}

export function WorkspacePagination({
  buttonClassName = "button button--secondary",
  className,
  currentPage,
  label,
  loading = false,
  nextLabel = "Next →",
  onPageChange,
  previousLabel = "← Previous",
  renderControl,
  totalPages,
}: WorkspacePaginationProps) {
  if (totalPages <= 1) return null;

  function control(
    direction: WorkspacePaginationControl["direction"],
    controlLabel: string,
  ) {
    const page = direction === "previous" ? currentPage - 1 : currentPage + 1;
    const disabled =
      loading ||
      (direction === "previous" ? currentPage <= 1 : currentPage >= totalPages);
    const definition: WorkspacePaginationControl = {
      className: buttonClassName,
      disabled,
      direction,
      label: controlLabel,
      page,
    };

    if (renderControl) return renderControl(definition);

    return (
      <button
        className={buttonClassName}
        type="button"
        disabled={disabled}
        onClick={() => onPageChange?.(page)}
      >
        {controlLabel}
      </button>
    );
  }

  return (
    <nav
      className={["pagination", "workspace-pagination", className]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
    >
      {control("previous", previousLabel)}
      <span className="pagination__status" aria-current="page">
        Page {currentPage} of {totalPages}
      </span>
      {control("next", nextLabel)}
    </nav>
  );
}
