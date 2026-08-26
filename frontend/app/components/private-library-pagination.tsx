interface PrivateLibraryPaginationProps {
  currentPage: number;
  label: string;
  loading: boolean;
  onPageChange: (page: number) => void;
  totalPages: number;
}

export function PrivateLibraryPagination({
  currentPage,
  label,
  loading,
  onPageChange,
  totalPages,
}: PrivateLibraryPaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label={label}>
      <button
        className="button button--secondary"
        type="button"
        disabled={loading || currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        ← Previous
      </button>
      <span className="pagination__status" aria-current="page">
        Page {currentPage} of {totalPages}
      </span>
      <button
        className="button button--secondary"
        type="button"
        disabled={loading || currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next →
      </button>
    </nav>
  );
}
