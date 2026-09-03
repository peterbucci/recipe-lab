import {
  recipeBrowseHref,
  type RecipeBrowseType,
} from "../../lib/recipe-browse-query";
import { WorkspacePagination } from "./workspace-pagination";

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
  return (
    <WorkspacePagination
      buttonClassName="button button--secondary pagination__link"
      className="pagination--catalog"
      currentPage={currentPage}
      disabledClassName="button button--disabled pagination__link pagination__link--disabled"
      hrefForPage={(page) =>
        recipeBrowseHref(page, query, { category, recipeType, sort })
      }
      label="Recipe result pages"
      totalPages={totalPages}
    />
  );
}
