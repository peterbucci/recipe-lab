import { useEffect, useRef, useState } from "react";

import { isAbortError } from "../../lib/abort-error";
import {
  type CatalogIngredientSelection,
  fetchMyIngredientRequest,
  IngredientCatalogApiError,
  type MemberIngredientRequest,
} from "../../lib/ingredient-catalog-api";

export interface MemberIngredientResolutionSelectionState {
  selectingRequestId: string | null;
  selectionError: string;
  clearSelectionError: () => void;
  selectResolution: (request: MemberIngredientRequest) => Promise<void>;
}

export function useMemberIngredientResolutionSelection({
  onAuthenticationExpired,
  onAuthenticationRestored,
  onSelectResolution,
  selectionEnabled,
}: {
  onAuthenticationExpired: () => void;
  onAuthenticationRestored: () => void;
  onSelectResolution?: (selection: CatalogIngredientSelection) => void;
  selectionEnabled: boolean;
}): MemberIngredientResolutionSelectionState {
  const selectionControllerRef = useRef<AbortController | null>(null);
  const selectionPendingRef = useRef(false);
  const [selectionError, setSelectionError] = useState("");
  const [selectingRequestId, setSelectingRequestId] = useState<string | null>(null);

  useEffect(
    () => () => {
      selectionControllerRef.current?.abort();
    },
    [],
  );

  async function selectResolution(request: MemberIngredientRequest) {
    if (
      selectionPendingRef.current ||
      !selectionEnabled ||
      !onSelectResolution ||
      !request.resolved_ingredient
    ) {
      return;
    }

    selectionPendingRef.current = true;
    selectionControllerRef.current?.abort();
    const controller = new AbortController();
    selectionControllerRef.current = controller;
    setSelectingRequestId(request.id);
    setSelectionError("");

    try {
      const current = await fetchMyIngredientRequest(request.id, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      const resolved = current.resolved_ingredient;
      if (
        current.id !== request.id ||
        (current.status !== "approved" && current.status !== "duplicate") ||
        resolved === null ||
        resolved.id !== request.resolved_ingredient.id
      ) {
        setSelectionError(
          "This request changed since it was loaded. Your recipe was not changed. Refresh your requests before choosing it.",
        );
        return;
      }

      onAuthenticationRestored();
      onSelectResolution({
        ingredientId: resolved.id,
        canonicalName: resolved.canonical_name,
        displayName: resolved.canonical_name,
      });
    } catch (reason) {
      if (!isAbortError(reason)) {
        if (reason instanceof IngredientCatalogApiError && reason.status === 401) {
          onAuthenticationExpired();
        }
        setSelectionError(
          reason instanceof IngredientCatalogApiError && reason.status === 401
            ? "Your session expired. Your recipe was not changed. Sign in again in another tab, then retry."
            : "We couldn’t confirm this catalog resolution. Your recipe was not changed. Try again.",
        );
      }
    } finally {
      selectionPendingRef.current = false;
      if (!controller.signal.aborted) {
        setSelectingRequestId(null);
      }
    }
  }

  return {
    clearSelectionError: () => setSelectionError(""),
    selectResolution,
    selectingRequestId,
    selectionError,
  };
}
