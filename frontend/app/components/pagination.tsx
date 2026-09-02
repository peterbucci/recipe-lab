import Link from "next/link";

import {
  recipeBrowseHref,
  type RecipeBrowseType,
} from "../../lib/recipe-browse-query";

interface PaginationProps {
  category?: string;
  currentPage: number;
  query: string;
  recipeType?: RecipeBrowseType;
  sort?: "newest" | "title";
  totalPages: number;
}

export function pageHref(page: number, query: string): string {
  return recipeBrowseHref(page, query);
}

export function Pagination({
  category,
  currentPage,
  query,
  recipeType,
  sort,
  totalPages,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="pagination pagination--catalog" aria-label="Recipe result pages">
      {currentPage > 1 ? (
        <Link
          className="button button--secondary pagination__link"
          href={recipeBrowseHref(currentPage - 1, query, {
            category,
            recipeType,
            sort,
          })}
        >
          ← Previous
        </Link>
      ) : (
        <span
          className="button button--disabled pagination__link pagination__link--disabled"
          aria-disabled="true"
        >
          ← Previous
        </span>
      )}
      <span className="pagination__status" aria-current="page">
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link
          className="button button--secondary pagination__link"
          href={recipeBrowseHref(currentPage + 1, query, {
            category,
            recipeType,
            sort,
          })}
        >
          Next →
        </Link>
      ) : (
        <span
          className="button button--disabled pagination__link pagination__link--disabled"
          aria-disabled="true"
        >
          Next →
        </span>
      )}
    </nav>
  );
}
