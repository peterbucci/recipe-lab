"use client";

import Link from "next/link";

import { RetryableStatePage } from "../../../../shared/ui/retryable-state-page";

interface RecipeCompareErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function RecipeCompareError({ retry }: RecipeCompareErrorProps) {
  return (
    <RetryableStatePage
      className="public-context-state"
      description="Try again, or browse the recipe collection."
      eyebrow="Something went wrong"
      headingId="recipe-comparison-error-title"
      retry={retry}
      secondaryAction={
        <Link className="button button--secondary" href="/recipes">
          Browse recipes
        </Link>
      }
      title="We couldn’t load this comparison."
    />
  );
}
