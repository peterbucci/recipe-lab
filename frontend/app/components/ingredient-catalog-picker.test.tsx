import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CatalogIngredientPage,
  CatalogIngredientSelection,
  MissingIngredientRequest,
} from "../../lib/ingredient-catalog-api";
import {
  searchCatalogIngredients,
  submitMissingIngredientRequest,
} from "../../lib/ingredient-catalog-api";
import { IngredientCatalogPicker } from "./ingredient-catalog-picker";

const mocks = vi.hoisted(() => ({
  searchCatalogIngredients: vi.fn(),
  submitMissingIngredientRequest: vi.fn(),
}));

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return {
    ...actual,
    searchCatalogIngredients: mocks.searchCatalogIngredients,
    submitMissingIngredientRequest: mocks.submitMissingIngredientRequest,
  };
});

const SUGAR_ID = "11111111-1111-4111-8111-111111111111";
const PECAN_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";

function page(
  overrides: Partial<CatalogIngredientPage> = {},
): CatalogIngredientPage {
  return {
    items: [
      {
        id: SUGAR_ID,
        canonical_name: "Granulated sugar",
        aliases: ["Caster sugar", "White sugar"],
      },
    ],
    page: 1,
    page_size: 20,
    total: 1,
    total_pages: 1,
    ...overrides,
  };
}

function request(
  proposedName = "Dragon fruit",
): MissingIngredientRequest {
  return {
    id: REQUEST_ID,
    proposed_name: proposedName,
    context: null,
    status: "pending",
    created_at: "2026-08-24T18:00:00Z",
    reviewed_at: null,
    decision_reason: null,
    resolved_ingredient_id: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function PickerHarness({
  initialValue = null,
  onSelection,
}: {
  initialValue?: CatalogIngredientSelection | null;
  onSelection?: (selection: CatalogIngredientSelection | null) => void;
}) {
  const [selection, setSelection] = useState(initialValue);
  return (
    <IngredientCatalogPicker
      idPrefix="test-ingredient"
      contextLabel="test ingredient"
      label="Ingredient"
      value={selection}
      onChange={(next) => {
        setSelection(next);
        onSelection?.(next);
      }}
    />
  );
}

beforeEach(() => {
  mocks.searchCatalogIngredients.mockReset();
  mocks.submitMissingIngredientRequest.mockReset();
});

describe("IngredientCatalogPicker", () => {
  it("searches from the keyboard and only selects an explicit catalog result", async () => {
    const lookup = deferred<CatalogIngredientPage>();
    vi.mocked(searchCatalogIngredients).mockReturnValue(lookup.promise);
    const onSelection = vi.fn();
    render(<PickerHarness onSelection={onSelection} />);

    const search = screen.getByRole("searchbox", { name: "Ingredient" });
    fireEvent.change(search, { target: { value: "White sugar" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(onSelection).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Searching…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Searching the ingredient catalog");

    await act(async () => {
      lookup.resolve(page());
      await lookup.promise;
    });

    const results = screen.getByRole("list", { name: "Ingredient catalog results" });
    const result = within(results).getByRole("button", { name: /white sugar/i });
    expect(result).toHaveTextContent("Catalog name: Granulated sugar");
    result.focus();
    fireEvent.keyDown(result, { key: "Enter" });
    fireEvent.click(result);

    expect(onSelection).toHaveBeenLastCalledWith({
      ingredientId: SUGAR_ID,
      canonicalName: "Granulated sugar",
      displayName: "White sugar",
    });
    expect(screen.getByText("Selected catalog ingredient")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /white sugar/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("discards a stale lookup when the query changes and reports an empty result", async () => {
    const staleLookup = deferred<CatalogIngredientPage>();
    vi.mocked(searchCatalogIngredients)
      .mockReturnValueOnce(staleLookup.promise)
      .mockResolvedValueOnce(page({ items: [], total: 0, total_pages: 0 }));
    render(<PickerHarness />);

    const search = screen.getByRole("searchbox", { name: "Ingredient" });
    fireEvent.change(search, { target: { value: "pecan" } });
    fireEvent.keyDown(search, { key: "Enter" });
    fireEvent.change(search, { target: { value: "dragon fruit" } });

    await act(async () => {
      staleLookup.resolve(
        page({
          items: [{ id: PECAN_ID, canonical_name: "Pecan", aliases: [] }],
        }),
      );
      await staleLookup.promise;
    });
    expect(screen.queryByText("Pecan")).not.toBeInTheDocument();

    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No catalog ingredients match dragon fruit.",
      ),
    );
    expect(search).toHaveValue("dragon fruit");
    expect(screen.getByRole("button", { name: "Request a missing ingredient" })).toBeVisible();
  });

  it("keeps the selected identity and query visible after a lookup failure", async () => {
    vi.mocked(searchCatalogIngredients).mockRejectedValue(new Error("offline"));
    render(
      <PickerHarness
        initialValue={{
          ingredientId: PECAN_ID,
          canonicalName: "Pecan",
          displayName: "Pecan",
        }}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Ingredient" });
    fireEvent.change(search, { target: { value: "almond" } });
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ingredient catalog could not be searched. Please try again.",
    );
    expect(search).toHaveValue("almond");
    expect(screen.getByText("Selected catalog ingredient")).toBeInTheDocument();
    expect(screen.getByText("Pecan", { selector: "strong" })).toBeInTheDocument();
  });

  it("pages bounded results without changing the typed query", async () => {
    vi.mocked(searchCatalogIngredients)
      .mockResolvedValueOnce(page({ total: 21, total_pages: 2 }))
      .mockResolvedValueOnce(
        page({
          items: [{ id: PECAN_ID, canonical_name: "Pecan", aliases: [] }],
          page: 2,
          total: 21,
          total_pages: 2,
        }),
      );
    render(<PickerHarness />);

    const search = screen.getByRole("searchbox", { name: "Ingredient" });
    fireEvent.change(search, { target: { value: "nut" } });
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    await screen.findByText("Granulated sugar");
    fireEvent.click(screen.getByRole("button", { name: "Next →" }));

    expect(await screen.findByText("Pecan")).toBeInTheDocument();
    expect(search).toHaveValue("nut");
    expect(searchCatalogIngredients).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "nut", page: 2, pageSize: 20 }),
    );
  });

  it("submits missing text separately, preserves editor state, and escapes status rendering", async () => {
    const unsafeName = '<img src=x onerror="alert(1)"> fruit';
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    vi.mocked(submitMissingIngredientRequest).mockResolvedValue(request(unsafeName));
    const onSelection = vi.fn();
    render(<PickerHarness onSelection={onSelection} />);

    const search = screen.getByRole("searchbox", { name: "Ingredient" });
    fireEvent.change(search, { target: { value: unsafeName } });
    fireEvent.keyDown(search, { key: "Enter" });
    await screen.findByText(/no catalog ingredients match/i);
    fireEvent.click(screen.getByRole("button", { name: "Request a missing ingredient" }));

    const proposedName = screen.getByLabelText("Proposed ingredient name");
    expect(proposedName).toHaveFocus();
    expect(proposedName).toHaveValue(unsafeName);
    fireEvent.change(screen.getByLabelText("Short context (optional)"), {
      target: { value: "Seen at a neighborhood market" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit catalog request" }));

    await waitFor(() => expect(submitMissingIngredientRequest).toHaveBeenCalledOnce());
    expect(submitMissingIngredientRequest).toHaveBeenCalledWith({
      proposed_name: unsafeName,
      context: "Seen at a neighborhood market",
    });
    expect(
      screen.getByText(
        new RegExp(
          `${unsafeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} was submitted`,
        ),
      ),
    ).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(search).toHaveValue(unsafeName);
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("preserves request input after a duplicate response", async () => {
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    vi.mocked(submitMissingIngredientRequest).mockRejectedValue(
      new Error("duplicate"),
    );
    render(<PickerHarness />);

    const search = screen.getByRole("searchbox", { name: "Ingredient" });
    fireEvent.change(search, { target: { value: "Dragon fruit" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await screen.findByText(/no catalog ingredients match/i);
    fireEvent.click(screen.getByRole("button", { name: "Request a missing ingredient" }));
    fireEvent.change(screen.getByLabelText("Short context (optional)"), {
      target: { value: "Fresh fruit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit catalog request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ingredient request could not be submitted. Please try again.",
    );
    expect(screen.getByLabelText("Proposed ingredient name")).toHaveValue("Dragon fruit");
    expect(screen.getByLabelText("Short context (optional)")).toHaveValue("Fresh fruit");
  });
});
