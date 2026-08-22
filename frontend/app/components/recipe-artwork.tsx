interface RecipeArtworkProps {
  lineageKey: string;
  className?: string;
}

function stableHash(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }

  return hash;
}

export function RecipeArtwork({ lineageKey, className = "" }: RecipeArtworkProps) {
  const seed = stableHash(lineageKey);
  const variant = seed % 4;
  const classes = ["recipe-artwork", `recipe-artwork--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  const ingredientOneX = 66 + (seed % 18);
  const ingredientOneY = 55 + ((seed >>> 3) % 14);
  const ingredientTwoX = 104 + ((seed >>> 6) % 17);
  const ingredientTwoY = 63 + ((seed >>> 9) % 13);
  const ingredientThreeX = 84 + ((seed >>> 12) % 25);
  const ingredientThreeY = 88 + ((seed >>> 15) % 11);

  return (
    <div className={classes} data-artwork-variant={variant} aria-hidden="true">
      <svg
        className="recipe-artwork__canvas"
        viewBox="0 0 180 140"
        focusable="false"
        role="presentation"
      >
        <path className="recipe-artwork__surface" d="M16 112c39-12 109-12 148 0v18H16z" />
        <ellipse className="recipe-artwork__plate" cx="90" cy="78" rx="60" ry="45" />
        <ellipse className="recipe-artwork__plate-rim" cx="90" cy="78" rx="45" ry="32" />
        <circle
          className="recipe-artwork__ingredient recipe-artwork__ingredient--one"
          cx={ingredientOneX}
          cy={ingredientOneY}
          r="13"
        />
        <circle
          className="recipe-artwork__ingredient recipe-artwork__ingredient--two"
          cx={ingredientTwoX}
          cy={ingredientTwoY}
          r="11"
        />
        <path
          className="recipe-artwork__ingredient recipe-artwork__ingredient--three"
          d={`M${ingredientThreeX - 15} ${ingredientThreeY + 5}q15-27 30 0q-15 15-30 0Z`}
        />
        <path
          className="recipe-artwork__garnish"
          d="M87 49c8-14 17-20 27-20M96 47c-1-12-6-21-15-26"
        />
        <path className="recipe-artwork__spark" d="m29 34 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" />
      </svg>
    </div>
  );
}
