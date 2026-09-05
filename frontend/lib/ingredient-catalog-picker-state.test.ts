import { describe, expect, it } from "vitest";

import {
  createIngredientCatalogPickerState,
  ingredientCatalogPickerReducer,
} from "./ingredient-catalog-picker-state";

describe("ingredientCatalogPickerReducer", () => {
  it("resets search state when an external selection changes", () => {
    const searching = ingredientCatalogPickerReducer(
      createIngredientCatalogPickerState({
        disabled: false,
        query: "sugar",
        selectionKey: "",
      }),
      { type: "search-started", query: "sugar" },
    );

    const synchronized = ingredientCatalogPickerReducer(searching, {
      type: "synchronize",
      disabled: false,
      query: "Granulated sugar",
      selectionKey: "catalog:sugar:Granulated sugar:Granulated sugar",
    });

    expect(synchronized).toMatchObject({
      activeIndex: -1,
      query: "Granulated sugar",
      popupOpen: false,
      searching: false,
      searchActive: false,
    });
  });

  it("keeps the typed query when editing clears an existing identity", () => {
    const selected = createIngredientCatalogPickerState({
      disabled: false,
      query: "Pecan",
      selectionKey: "catalog:pecan:Pecan:Pecan",
    });

    const edited = ingredientCatalogPickerReducer(selected, {
      type: "input-changed",
      query: "almond",
      searchStatus: "",
      selectionKey: "",
    });

    expect(edited).toMatchObject({
      query: "almond",
      selectionKey: "",
      searchActive: true,
      popupOpen: true,
    });
  });

  it("retains successful results while a retry is in progress", () => {
    const resultPage = {
      items: [],
      page: 1,
      page_size: 8,
      total: 0,
      total_pages: 0,
    };
    const settled = ingredientCatalogPickerReducer(
      createIngredientCatalogPickerState({
        disabled: false,
        query: "sugar",
        selectionKey: "",
      }),
      {
        type: "search-settled",
        authenticationSearchError: "",
        catalogPage: resultPage,
        failedSearchResources: ["requests"],
        popupOpen: true,
        searchStatus: "Some ingredient suggestions are unavailable.",
      },
    );

    const retrying = ingredientCatalogPickerReducer(settled, {
      type: "retry-requested",
    });

    expect(retrying.resultPage).toBe(resultPage);
    expect(retrying.searchRetryRevision).toBe(1);
    expect(retrying.searching).toBe(true);
  });
});
