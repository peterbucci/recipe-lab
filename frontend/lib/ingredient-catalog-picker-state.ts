import type {
  CatalogIngredientPage,
  MemberIngredientRequest,
} from "./ingredient-catalog-api";

export type IngredientSearchResource = "catalog" | "requests";

export interface IngredientCatalogPickerState {
  activeIndex: number;
  authenticationSearchError: string;
  disabled: boolean;
  failedSearchResources: IngredientSearchResource[];
  hasSearched: boolean;
  pendingRequests: MemberIngredientRequest[];
  popupOpen: boolean;
  query: string;
  requestOpen: boolean;
  resultPage: CatalogIngredientPage | null;
  searchedQuery: string;
  searching: boolean;
  searchActive: boolean;
  searchRetryRevision: number;
  searchStatus: string;
  selectionKey: string;
}

export type IngredientCatalogPickerAction =
  | {
      type: "synchronize";
      disabled: boolean;
      query: string;
      selectionKey: string;
    }
  | { type: "focus" }
  | { type: "blur" }
  | {
      type: "input-changed";
      query: string;
      searchStatus: string;
      selectionKey: string;
    }
  | { type: "search-started"; query: string }
  | {
      type: "search-settled";
      authenticationSearchError: string;
      catalogPage?: CatalogIngredientPage;
      failedSearchResources: IngredientSearchResource[];
      pendingRequests?: MemberIngredientRequest[];
      popupOpen: boolean;
      searchStatus: string;
    }
  | { type: "search-finished" }
  | { type: "move-active"; direction: "next" | "previous"; optionCount: number }
  | {
      type: "ingredient-selected";
      query: string;
      searchStatus: string;
      selectionKey: string;
    }
  | { type: "suggestions-closed" }
  | { type: "request-opened" }
  | { type: "request-closed" }
  | {
      type: "request-submitted";
      query: string;
      searchStatus: string;
      selectionKey: string;
    }
  | { type: "retry-requested" };

export function createIngredientCatalogPickerState({
  disabled,
  query,
  selectionKey,
}: {
  disabled: boolean;
  query: string;
  selectionKey: string;
}): IngredientCatalogPickerState {
  return {
    activeIndex: -1,
    authenticationSearchError: "",
    disabled,
    failedSearchResources: [],
    hasSearched: false,
    pendingRequests: [],
    popupOpen: false,
    query,
    requestOpen: false,
    resultPage: null,
    searchedQuery: "",
    searching: false,
    searchActive: false,
    searchRetryRevision: 0,
    searchStatus: "",
    selectionKey,
  };
}

function clearedSearchState(
  state: IngredientCatalogPickerState,
): IngredientCatalogPickerState {
  return {
    ...state,
    activeIndex: -1,
    authenticationSearchError: "",
    failedSearchResources: [],
    hasSearched: false,
    pendingRequests: [],
    popupOpen: false,
    resultPage: null,
    searching: false,
  };
}

export function ingredientCatalogPickerReducer(
  state: IngredientCatalogPickerState,
  action: IngredientCatalogPickerAction,
): IngredientCatalogPickerState {
  switch (action.type) {
    case "synchronize":
      return createIngredientCatalogPickerState(action);
    case "focus":
      return { ...state, popupOpen: true, searchActive: true };
    case "blur":
      return { ...state, popupOpen: false };
    case "input-changed":
      return {
        ...clearedSearchState(state),
        query: action.query,
        popupOpen: true,
        searchActive: true,
        searchStatus: action.searchStatus,
        selectionKey: action.selectionKey,
      };
    case "search-started":
      return {
        ...state,
        activeIndex: -1,
        authenticationSearchError: "",
        failedSearchResources: [],
        hasSearched: false,
        searchedQuery: action.query,
        searching: true,
        searchStatus: "Searching ingredients…",
      };
    case "search-settled":
      return {
        ...state,
        authenticationSearchError: action.authenticationSearchError,
        failedSearchResources: action.failedSearchResources,
        hasSearched: action.catalogPage ? true : state.hasSearched,
        pendingRequests: action.pendingRequests ?? state.pendingRequests,
        popupOpen: action.popupOpen,
        resultPage: action.catalogPage ?? state.resultPage,
        searchStatus: action.searchStatus,
      };
    case "search-finished":
      return { ...state, searching: false };
    case "move-active": {
      if (action.optionCount <= 0) return state;
      const activeIndex =
        action.direction === "next"
          ? state.activeIndex < action.optionCount - 1
            ? state.activeIndex + 1
            : 0
          : state.activeIndex > 0
            ? state.activeIndex - 1
            : action.optionCount - 1;
      return { ...state, activeIndex, popupOpen: true };
    }
    case "ingredient-selected":
      return {
        ...clearedSearchState(state),
        query: action.query,
        requestOpen: false,
        searchedQuery: "",
        searchActive: false,
        searchStatus: action.searchStatus,
        selectionKey: action.selectionKey,
      };
    case "suggestions-closed":
      return {
        ...clearedSearchState(state),
        searchActive: false,
        searchStatus: "Ingredient suggestions closed.",
      };
    case "request-opened":
      return { ...state, popupOpen: false, requestOpen: true };
    case "request-closed":
      return { ...state, requestOpen: false };
    case "request-submitted":
      return {
        ...state,
        hasSearched: false,
        query: action.query,
        requestOpen: false,
        searchActive: false,
        searchStatus: action.searchStatus,
        selectionKey: action.selectionKey,
      };
    case "retry-requested":
      return {
        ...state,
        searching: true,
        searchRetryRevision: state.searchRetryRevision + 1,
        searchStatus: "Searching ingredients…",
      };
  }
}
