import Link from "next/link";

import { recipeBrowseHref, type RecipeBrowseType } from "../../lib/recipe-browse-query";

interface RecipeSearchProps {
  query: string;
  recipeType: RecipeBrowseType;
}

export function RecipeSearch({ query, recipeType }: RecipeSearchProps) {
  return (
    <form className="recipe-search" action="/recipes" method="get" role="search">
      <label className="recipe-search__label" htmlFor="recipe-search-input">
        Search by recipe name
      </label>
      <p className="visually-hidden" id="recipe-search-help">
        Search recipe titles and descriptions
      </p>
      <div className="recipe-search__controls">
        {recipeType !== "all" ? <input name="type" type="hidden" value={recipeType} /> : null}
        <input
          aria-describedby="recipe-search-help"
          id="recipe-search-input"
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
          <Link className="button button--quiet" href={recipeBrowseHref(1, "", recipeType)}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
