import Link from "next/link";

import { recipeBrowseHref } from "../../lib/recipe-browse-query";

interface RecipeSearchProps {
  ariaLabel?: string;
  idPrefix?: string;
  query: string;
}

export function RecipeSearch({
  ariaLabel = "Search recipe catalog",
  idPrefix = "recipe-search",
  query,
}: RecipeSearchProps) {
  const helpId = `${idPrefix}-help`;
  const inputId = `${idPrefix}-input`;

  return (
    <form
      className="recipe-search"
      action="/recipes"
      method="get"
      role="search"
      aria-label={ariaLabel}
    >
      <label className="recipe-search__label" htmlFor={inputId}>
        Search by recipe name
      </label>
      <p className="visually-hidden" id={helpId}>
        Search recipe titles and descriptions
      </p>
      <div className="recipe-search__controls">
        <input
          aria-describedby={helpId}
          id={inputId}
          name="q"
          type="search"
          maxLength={100}
          defaultValue={query}
          placeholder="Try carrot, soup, or breakfast"
        />
        <button className="button button--primary" type="submit">
          Search
        </button>
        {query ? (
          <Link className="button button--quiet" href={recipeBrowseHref(1, "")}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
