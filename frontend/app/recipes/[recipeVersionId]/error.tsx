"use client";

import Link from "next/link";

import { RetryableStatePage } from "../../../shared/ui/retryable-state-page";

interface RecipeDetailErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function RecipeDetailError({ retry }: RecipeDetailErrorProps) {
  return (
    <RetryableStatePage
      description="Try again, or browse the recipe collection."
      eyebrow="Something went wrong"
      headingId="recipe-detail-error-title"
      panelClassName="state-panel--wide"
      retry={retry}
      secondaryAction={
        <Link className="button button--secondary" href="/recipes">
          Browse recipes
        </Link>
      }
      title="We couldn’t load this recipe."
    />
  );
}
