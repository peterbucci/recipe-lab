"use client";

import Link from "next/link";

import { RetryableStatePage } from "../../shared/ui/retryable-state-page";

interface RecipeErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function RecipeError({ retry }: RecipeErrorProps) {
  return (
    <RetryableStatePage
      className="catalog-state-page"
      description="Try again, or return to the home page."
      eyebrow="Something went wrong"
      headingId="catalog-error-title"
      panelClassName="catalog-state-panel"
      retry={retry}
      secondaryAction={
        <Link className="button button--secondary" href="/">
          Return home
        </Link>
      }
      title="We couldn’t load the recipes."
    />
  );
}
