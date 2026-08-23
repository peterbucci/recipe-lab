import Link from "next/link";

import { recipeBrowseHref, type RecipeBrowseType } from "../../lib/recipe-browse-query";

interface PaginationProps {
  currentPage: number;
  query: string;
  recipeType: RecipeBrowseType;
  totalPages: number;
}

export function pageHref(
  page: number,
  query: string,
  recipeType: RecipeBrowseType = "all",
): string {
  return recipeBrowseHref(page, query, recipeType);
}

export function Pagination({ currentPage, query, recipeType, totalPages }: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="pagination" aria-label="Recipe result pages">
      {currentPage > 1 ? (
        <Link
          className="button button--secondary"
          href={recipeBrowseHref(currentPage - 1, query, recipeType)}
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
          href={recipeBrowseHref(currentPage + 1, query, recipeType)}
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
