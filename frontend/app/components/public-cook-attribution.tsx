import Link from "next/link";

import type { RecipeSummary } from "../../lib/recipe-api";

interface PublicCookAttributionProps {
  author: RecipeSummary["author"];
}

export function PublicCookAttribution({ author }: PublicCookAttributionProps) {
  if (!author.handle) {
    return <span>{author.display_name}</span>;
  }

  return (
    <Link href={`/cooks/${encodeURIComponent(author.handle)}`}>
      {author.display_name}
    </Link>
  );
}
