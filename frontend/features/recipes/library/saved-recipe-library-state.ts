import type { SavedRecipeLibraryPage } from "./recipe-library-model";

interface SavedRecipeLibraryResult {
  key: string;
  page: SavedRecipeLibraryPage;
  snapshotId: number;
}

interface SavedRecipeLibraryMessage {
  key: string;
  message: string;
}

interface SavedRecipeLibraryResourceMessage
  extends SavedRecipeLibraryMessage {
  snapshotId: number;
}

type SavedRecipeLibraryLoadState =
  | { phase: "idle" }
  | { key: string; phase: "loading"; requestId: number }
  | { key: string; message: string; phase: "failed"; requestId: number };

export interface SavedRecipeRemovalAttempt {
  attemptId: number;
  originKey: string;
  originSnapshotId: number;
  recipeVersionId: string;
}

export interface SavedRecipeLibraryState {
  load: SavedRecipeLibraryLoadState;
  operationError: SavedRecipeLibraryResourceMessage | null;
  removal: SavedRecipeRemovalAttempt | null;
  result: SavedRecipeLibraryResult | null;
  status: (SavedRecipeLibraryMessage & { focus: boolean }) | null;
}

export type SavedRecipeLibraryAction =
  | { key: string; type: "location_changed" }
  | { key: string; requestId: number; type: "load_started" }
  | {
      key: string;
      page: SavedRecipeLibraryPage;
      requestId: number;
      snapshotId: number;
      type: "load_succeeded";
    }
  | {
      key: string;
      message: string;
      requestId: number;
      type: "load_failed";
    }
  | { attempt: SavedRecipeRemovalAttempt; type: "removal_started" }
  | {
      attempt: SavedRecipeRemovalAttempt;
      message: string;
      type: "removal_failed";
    }
  | {
      attempt: SavedRecipeRemovalAttempt;
      message: string;
      targetKey: string;
      type: "removal_succeeded";
    }
  | { attemptId: number; type: "removal_finished" };

export interface CurrentSavedRecipeLibraryState {
  error: string;
  focusStatus: boolean;
  loading: boolean;
  operationError: string;
  page: SavedRecipeLibraryPage | null;
  removingId: string | null;
  snapshotId: number | null;
  status: string;
}

export function createSavedRecipeLibraryState(
  key: string,
): SavedRecipeLibraryState {
  return {
    load: { key, phase: "loading", requestId: 0 },
    operationError: null,
    removal: null,
    result: null,
    status: null,
  };
}

function isAttemptCurrent(
  state: SavedRecipeLibraryState,
  attempt: SavedRecipeRemovalAttempt,
): boolean {
  return (
    state.removal?.attemptId === attempt.attemptId &&
    state.result?.key === attempt.originKey &&
    state.result.snapshotId === attempt.originSnapshotId
  );
}

export function savedRecipeLibraryReducer(
  state: SavedRecipeLibraryState,
  action: SavedRecipeLibraryAction,
): SavedRecipeLibraryState {
  switch (action.type) {
    case "location_changed":
      return {
        ...state,
        operationError:
          state.operationError?.key === action.key
            ? state.operationError
            : null,
        status: state.status?.key === action.key ? state.status : null,
      };
    case "load_started":
      return {
        ...state,
        load: {
          key: action.key,
          phase: "loading",
          requestId: action.requestId,
        },
      };
    case "load_succeeded":
      if (
        state.load.phase !== "loading" ||
        state.load.key !== action.key ||
        state.load.requestId !== action.requestId
      ) {
        return state;
      }
      return {
        ...state,
        load: { phase: "idle" },
        result: {
          key: action.key,
          page: action.page,
          snapshotId: action.snapshotId,
        },
      };
    case "load_failed":
      if (
        state.load.phase !== "loading" ||
        state.load.key !== action.key ||
        state.load.requestId !== action.requestId
      ) {
        return state;
      }
      return {
        ...state,
        load: {
          key: action.key,
          message: action.message,
          phase: "failed",
          requestId: action.requestId,
        },
      };
    case "removal_started":
      return {
        ...state,
        operationError: null,
        removal: action.attempt,
        status: null,
      };
    case "removal_failed":
      return isAttemptCurrent(state, action.attempt)
        ? {
            ...state,
            operationError: {
              key: action.attempt.originKey,
              message: action.message,
              snapshotId: action.attempt.originSnapshotId,
            },
          }
        : state;
    case "removal_succeeded": {
      if (!isAttemptCurrent(state, action.attempt) || !state.result) {
        return state;
      }
      const items = state.result.page.items.filter(
        (item) => item.recipe.id !== action.attempt.recipeVersionId,
      );
      const removed = items.length < state.result.page.items.length;
      const total = Math.max(
        0,
        state.result.page.total - (removed ? 1 : 0),
      );
      return {
        ...state,
        operationError: null,
        result: {
          ...state.result,
          page: {
            ...state.result.page,
            items,
            total,
            total_pages: Math.ceil(total / state.result.page.page_size),
          },
        },
        status: {
          focus: true,
          key: action.targetKey,
          message: action.message,
        },
      };
    }
    case "removal_finished":
      return state.removal?.attemptId === action.attemptId
        ? { ...state, removal: null }
        : state;
  }
}

export function currentSavedRecipeLibraryState(
  state: SavedRecipeLibraryState,
  key: string,
): CurrentSavedRecipeLibraryState {
  const result = state.result?.key === key ? state.result : null;
  const error =
    state.load.phase === "failed" && state.load.key === key
      ? state.load.message
      : "";
  const operationError =
    result &&
    state.operationError?.key === key &&
    state.operationError.snapshotId === result.snapshotId
      ? state.operationError.message
      : "";
  const removal =
    result &&
    state.removal?.originKey === key &&
    state.removal.originSnapshotId === result.snapshotId
      ? state.removal
      : null;
  const status = state.status?.key === key ? state.status : null;

  return {
    error,
    focusStatus: status?.focus ?? false,
    loading:
      (state.load.phase === "loading" && state.load.key === key) ||
      (!result && !error),
    operationError,
    page: result?.page ?? null,
    removingId: removal?.recipeVersionId ?? null,
    snapshotId: result?.snapshotId ?? null,
    status: status?.message ?? "",
  };
}
