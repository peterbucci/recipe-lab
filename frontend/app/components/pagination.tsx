import Link from "next/link";

import { recipeBrowseHref } from "../../lib/recipe-browse-query";

interface PaginationProps {
  currentPage: number;
  query: string;
  totalPages: number;
}

export function pageHref(page: number, query: string): string {
  return recipeBrowseHref(page, query);
}

export function Pagination({ currentPage, query, totalPages }: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="pagination" aria-label="Recipe result pages">
      {currentPage > 1 ? (
        <Link
          className="button button--secondary"
          href={recipeBrowseHref(currentPage - 1, query)}
        >
          ← Previous
        </Link>
      ) : (
        <span className="button button--disabled" aria-disabled="true">
          ← Previous
        </span>
      )}
      <span className="pagination__status" aria-current="page">
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link
          className="button button--secondary"
          href={recipeBrowseHref(currentPage + 1, query)}
        >
          Next →
        </Link>
      ) : (
        <span className="button button--disabled" aria-disabled="true">
          Next →
        </span>
      )}
    </nav>
  );
}
