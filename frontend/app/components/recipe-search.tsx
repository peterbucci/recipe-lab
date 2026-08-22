import Link from "next/link";

interface RecipeSearchProps {
  query: string;
}

export function RecipeSearch({ query }: RecipeSearchProps) {
  return (
    <form className="recipe-search" action="/recipes" method="get" role="search">
      <label className="recipe-search__label" htmlFor="recipe-search-input">
        Search recipes
      </label>
      <p className="recipe-search__help" id="recipe-search-help">
        Search recipe titles and descriptions.
      </p>
      <div className="recipe-search__controls">
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
          <Link className="button button--quiet" href="/recipes">
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
