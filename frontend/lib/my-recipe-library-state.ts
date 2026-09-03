import type { MyRecipeLibraryPage } from "./recipe-library-api";

interface KeyedMessage {
  key: string;
  message: string;
}

interface KeyedStatus extends KeyedMessage {
  focus: boolean;
}

type LibraryLoadState =
  | { phase: "idle" }
  | { phase: "loading"; key: string }
  | { phase: "failed"; key: string; message: string };

type LibraryConfirmationState =
  | { phase: "closed" }
  | { phase: "open"; draftId: string; key: string };

type LibraryDiscardState =
  | { phase: "idle" }
  | { phase: "pending"; draftId: string; key: string };

export interface MyRecipeLibraryState {
  confirmation: LibraryConfirmationState;
  discard: LibraryDiscardState;
  load: LibraryLoadState;
  operationError: KeyedMessage | null;
  result: { key: string; page: MyRecipeLibraryPage } | null;
  status: KeyedStatus | null;
}

export type MyRecipeLibraryAction =
  | { type: "location_changed"; key: string }
  | { type: "load_started"; key: string }
  | { type: "load_succeeded"; key: string; page: MyRecipeLibraryPage }
  | { type: "load_failed"; key: string; message: string }
  | { type: "load_cancelled"; key: string }
  | { type: "confirmation_toggled"; key: string; draftId: string }
  | { type: "confirmation_closed" }
  | { type: "discard_started"; key: string; draftId: string }
  | { type: "discard_failed"; key: string; message: string }
  | { type: "discard_finished"; draftId: string }
  | { type: "status_set"; key: string; message: string; focus: boolean }
  | {
      type: "item_removed";
      itemKey: string;
      message: string;
      originKey: string;
      targetKey: string;
    };

export interface CurrentMyRecipeLibraryState {
  confirmingId: string | null;
  discardingId: string | null;
  error: string;
  focusStatus: boolean;
  loading: boolean;
  operationError: string;
  page: MyRecipeLibraryPage | null;
  status: string;
}

export function createMyRecipeLibraryState(key: string): MyRecipeLibraryState {
  return {
    confirmation: { phase: "closed" },
    discard: { phase: "idle" },
    load: { phase: "loading", key },
    operationError: null,
    result: null,
    status: null,
  };
}

function itemKey(item: MyRecipeLibraryPage["items"][number]): string {
  return item.kind === "draft"
    ? `draft:${item.draft.id}`
    : `published:${item.recipe.id}`;
}

export function myRecipeLibraryReducer(
  state: MyRecipeLibraryState,
  action: MyRecipeLibraryAction,
): MyRecipeLibraryState {
  switch (action.type) {
    case "location_changed":
      return {
        ...state,
        confirmation:
          state.confirmation.phase === "open" &&
          state.confirmation.key === action.key
            ? state.confirmation
            : { phase: "closed" },
        operationError:
          state.operationError?.key === action.key
            ? state.operationError
            : null,
        status: state.status?.key === action.key ? state.status : null,
      };
    case "load_started":
      return { ...state, load: { phase: "loading", key: action.key } };
    case "load_succeeded":
      return {
        ...state,
        load: { phase: "idle" },
        result: { key: action.key, page: action.page },
      };
    case "load_failed":
      return {
        ...state,
        load: {
          phase: "failed",
          key: action.key,
          message: action.message,
        },
      };
    case "load_cancelled":
      return state.load.phase === "loading" && state.load.key === action.key
        ? { ...state, load: { phase: "idle" } }
        : state;
    case "confirmation_toggled":
      return {
        ...state,
        confirmation:
          state.confirmation.phase === "open" &&
          state.confirmation.key === action.key &&
          state.confirmation.draftId === action.draftId
            ? { phase: "closed" }
            : { phase: "open", key: action.key, draftId: action.draftId },
      };
    case "confirmation_closed":
      return { ...state, confirmation: { phase: "closed" } };
    case "discard_started":
      return {
        ...state,
        discard: {
          phase: "pending",
          key: action.key,
          draftId: action.draftId,
        },
        operationError: null,
        status: null,
      };
    case "discard_failed":
      return {
        ...state,
        operationError: { key: action.key, message: action.message },
      };
    case "discard_finished":
      return state.discard.phase === "pending" &&
        state.discard.draftId === action.draftId
        ? { ...state, discard: { phase: "idle" } }
        : state;
    case "status_set":
      return {
        ...state,
        status: {
          focus: action.focus,
          key: action.key,
          message: action.message,
        },
      };
    case "item_removed": {
      const result = state.result?.key === action.originKey
        ? (() => {
            const items = state.result.page.items.filter(
              (item) => itemKey(item) !== action.itemKey,
            );
            const total = Math.max(
              0,
              state.result.page.total -
                (items.length < state.result.page.items.length ? 1 : 0),
            );
            return {
              key: state.result.key,
              page: {
                ...state.result.page,
                items,
                total,
                total_pages: Math.ceil(total / state.result.page.page_size),
              },
            };
          })()
        : state.result;
      return {
        ...state,
        confirmation: { phase: "closed" },
        result,
        status: {
          focus: true,
          key: action.targetKey,
          message: action.message,
        },
      };
    }
  }
}

export function currentMyRecipeLibraryState(
  state: MyRecipeLibraryState,
  key: string,
): CurrentMyRecipeLibraryState {
  const page = state.result?.key === key ? state.result.page : null;
  const error =
    state.load.phase === "failed" && state.load.key === key
      ? state.load.message
      : "";
  const status = state.status?.key === key ? state.status : null;
  return {
    confirmingId:
      state.confirmation.phase === "open" && state.confirmation.key === key
        ? state.confirmation.draftId
        : null,
    discardingId:
      state.discard.phase === "pending" && state.discard.key === key
        ? state.discard.draftId
        : null,
    error,
    focusStatus: status?.focus ?? false,
    loading:
      (state.load.phase === "loading" && state.load.key === key) ||
      (!page && !error),
    operationError:
      state.operationError?.key === key ? state.operationError.message : "",
    page,
    status: status?.message ?? "",
  };
}
