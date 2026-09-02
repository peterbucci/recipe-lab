"use client";

import { useRouter } from "next/navigation";

import {
  recipeBrowseHref,
  type RecipeBrowseType,
} from "../../lib/recipe-browse-query";

interface RecipeCatalogFiltersProps {
  category?: string;
  query: string;
  recipeType?: RecipeBrowseType;
  sort: "newest" | "title";
}

export function RecipeCatalogFilters({
  category,
  query,
  recipeType,
  sort,
}: RecipeCatalogFiltersProps) {
  const router = useRouter();

  function navigate(next: {
    sort: "newest" | "title";
  }) {
    router.push(
      recipeBrowseHref(1, query, {
        category,
        recipeType,
        sort: next.sort,
      }),
    );
  }

  return (
    <div className="catalog-filter-controls">
      <label className="catalog-filter-select catalog-filter-select--sort">
        <span>Sort</span>
        <select
          aria-label="Sort recipes"
          value={sort}
          onChange={(event) => {
            navigate({
              sort: event.currentTarget.value === "title" ? "title" : "newest",
            });
          }}
        >
          <option value="newest">Recently published</option>
          <option value="title">Title A–Z</option>
        </select>
      </label>
    </div>
  );
}
