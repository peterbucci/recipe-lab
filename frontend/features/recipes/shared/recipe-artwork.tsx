interface RecipeArtworkProps {
  recipeKey: string;
  className?: string;
}

const ARTWORK_PALETTE_COUNT = 8;
const SEGMENTS = [1, 2, 3, 4] as const;

function stableHash(value: string) {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function RecipeArtwork({ recipeKey, className = "" }: RecipeArtworkProps) {
  const seed = stableHash(recipeKey);
  const variant = seed % ARTWORK_PALETTE_COUNT;
  const classes = ["recipe-artwork", `recipe-artwork--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-artwork-variant={variant} aria-hidden="true">
      <span className="recipe-artwork__plate-shadow" />
      <span className="recipe-artwork__plate">
        <span className="recipe-artwork__plate-inner">
          <span className="recipe-artwork__food recipe-artwork__food--red" />
          <span className="recipe-artwork__food recipe-artwork__food--orange">
            {SEGMENTS.map((segment) => (
              <span
                className={`recipe-artwork__segment recipe-artwork__segment--${segment}`}
                key={segment}
              />
            ))}
          </span>
          <span className="recipe-artwork__food recipe-artwork__food--lime">
            {SEGMENTS.map((segment) => (
              <span
                className={`recipe-artwork__segment recipe-artwork__segment--${segment}`}
                key={segment}
              />
            ))}
          </span>
        </span>
      </span>
    </div>
  );
}
