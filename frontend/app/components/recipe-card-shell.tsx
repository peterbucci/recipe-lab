import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface RecipeCardShellProps
  extends Omit<
    ComponentPropsWithoutRef<"article">,
    "aria-labelledby" | "children"
  > {
  "aria-labelledby": string;
  artwork: ReactNode;
  bodyClassName: string;
  children: ReactNode;
  itemClassName: string;
}

export function RecipeCardShell({
  artwork,
  bodyClassName,
  children,
  itemClassName,
  ...articleProps
}: RecipeCardShellProps) {
  return (
    <li className={itemClassName}>
      <article {...articleProps}>
        {artwork}
        <div className={bodyClassName}>{children}</div>
      </article>
    </li>
  );
}
