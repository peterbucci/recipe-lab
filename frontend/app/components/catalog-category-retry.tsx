"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { LoadingButton } from "./loading-ui";

export function CatalogCategoryRetry() {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();

  return (
    <LoadingButton
      className="catalog-category-retry"
      pending={retrying}
      pendingLabel="Trying again…"
      onClick={() => {
        startRetry(() => router.refresh());
      }}
      type="button"
    >
      Try again
    </LoadingButton>
  );
}
