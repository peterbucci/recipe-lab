import Link from "next/link";

import type { PublicUserReference } from "../../lib/recipe-api";

interface PublicCookAttributionProps {
  author: PublicUserReference;
}

export function PublicCookAttribution({ author }: PublicCookAttributionProps) {
  if (author.handle === null) {
    return <span>{author.display_name}</span>;
  }

  return (
    <Link href={`/cooks/${encodeURIComponent(author.handle)}`}>
      {author.display_name}
    </Link>
  );
}
