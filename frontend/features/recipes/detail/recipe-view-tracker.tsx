"use client";

import { useEffect, useRef } from "react";

import { createIdempotencyKey } from "../../../shared/api/idempotency-key";
import { recordRecipeView } from "./interaction-api";

interface RecipeViewTrackerProps {
  recipeVersionId: string;
}

interface TrackedView {
  recipeVersionId: string;
  idempotencyKey: string;
}

export function RecipeViewTracker({ recipeVersionId }: RecipeViewTrackerProps) {
  const trackedViewRef = useRef<TrackedView | null>(null);

  useEffect(() => {
    if (trackedViewRef.current?.recipeVersionId !== recipeVersionId) {
      trackedViewRef.current = {
        recipeVersionId,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    const trackedView = trackedViewRef.current;
    void recordRecipeView(
      trackedView.recipeVersionId,
      trackedView.idempotencyKey,
    ).catch(() => undefined);
  }, [recipeVersionId]);

  return null;
}
