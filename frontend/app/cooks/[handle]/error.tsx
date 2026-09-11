"use client";

import Link from "next/link";

import { RetryableStatePage } from "../../../shared/ui/retryable-state-page";

export default function CookProfileError({ retry }: { retry: () => void }) {
  return (
    <RetryableStatePage
      panelClassName="state-panel--wide"
      description="Try again, or browse the recipe collection."
      eyebrow="Something went wrong"
      headingId="cook-profile-error-title"
      retry={retry}
      secondaryAction={
        <Link className="button button--secondary" href="/recipes">
          Browse recipes
        </Link>
      }
      title="We couldn’t load this cook’s profile."
    />
  );
}
