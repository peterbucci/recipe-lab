import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CatalogIngredientPage,
  CatalogIngredientSelection,
  MemberIngredientRequest,
  MemberIngredientRequestPage,
  MissingIngredientRequest,
} from "../../lib/ingredient-catalog-api";
import {
  fetchMyIngredientRequest,
  searchCatalogIngredients,
  submitMissingIngredientRequest,
} from "../../lib/ingredient-catalog-api";
import { IngredientCatalogPicker } from "./ingredient-catalog-picker";

const mocks = vi.hoisted(() => ({
  browseMyIngredientRequests: vi.fn(),
  fetchMyIngredientRequest: vi.fn(),
  searchCatalogIngredients: vi.fn(),
  submitMissingIngredientRequest: vi.fn(),
}));

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return {
    ...actual,
    browseMyIngredientRequests: mocks.browseMyIngredientRequests,
    fetchMyIngredientRequest: mocks.fetchMyIngredientRequest,
    searchCatalogIngredients: mocks.searchCatalogIngredients,
    submitMissingIngredientRequest: mocks.submitMissingIngredientRequest,
  };
});

const SUGAR_ID = "11111111-1111-4111-8111-111111111111";
const PECAN_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";

function approvedRequest(): MemberIngredientRequest {
  return {
    id: REQUEST_ID,
    proposed_name: "Dragon fruit request text",
    context: "Fresh pink fruit",
    status: "approved",
    created_at: "2026-08-24T18:00:00Z",
    reviewed_at: "2026-08-24T19:00:00Z",
    decision_reason: "Added as Pitaya.",
    resolved_ingredient_id: SUGAR_ID,
    resolved_ingredient: {
      id: SUGAR_ID,
      canonical_name: "Pitaya",
      aliases: ["Dragon fruit"],
    },
  };
}

function requestHistoryPage(): MemberIngredientRequestPage {
  return {
    items: [approvedRequest()],
    page: 1,
    page_size: 10,
    total: 1,
    total_pages: 1,
  };
}

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
  mocks.browseMyIngredientRequests.mockReset();
  mocks.fetchMyIngredientRequest.mockReset();
  mocks.searchCatalogIngredients.mockReset();
  mocks.submitMissingIngredientRequest.mockReset();
  mocks.browseMyIngredientRequests.mockResolvedValue(requestHistoryPage());
  mocks.fetchMyIngredientRequest.mockResolvedValue(approvedRequest());
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

  it("selects a freshly confirmed request resolution and returns focus to this picker", async () => {
    const onSelection = vi.fn();
    render(<PickerHarness onSelection={onSelection} />);

    const trigger = screen.getByRole("button", {
      name: "Choose from my ingredient requests for test ingredient",
    });
    fireEvent.click(trigger);
    const region = await screen.findByRole("region", {
      name: "Choose from my ingredient requests for test ingredient",
    });
    fireEvent.click(
      await within(region).findByRole("button", {
        name: "Use Pitaya for test ingredient",
      }),
    );

    await waitFor(() =>
      expect(onSelection).toHaveBeenCalledWith({
        ingredientId: SUGAR_ID,
        canonicalName: "Pitaya",
        displayName: "Pitaya",
      }),
    );
    expect(fetchMyIngredientRequest).toHaveBeenCalledWith(REQUEST_ID, expect.any(AbortSignal));
    expect(screen.queryByRole("region", { name: /choose from my ingredient requests/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(
      screen.getByText(
        "Pitaya was selected from your resolved ingredient requests for test ingredient.",
        { selector: ".ingredient-picker__request-status" },
      ),
    ).toHaveAttribute("role", "status");
    expect(screen.getByText("Pitaya", { selector: ".ingredient-picker__selection strong" })).toBeVisible();
  });

  it("keeps the current picker value and query when resolution confirmation fails", async () => {
    mocks.fetchMyIngredientRequest.mockRejectedValue(new Error("offline"));
    const onSelection = vi.fn();
    render(
      <PickerHarness
        initialValue={{
          ingredientId: PECAN_ID,
          canonicalName: "Pecan",
          displayName: "Pecan",
        }}
        onSelection={onSelection}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Ingredient" });
    fireEvent.change(search, { target: { value: "almond" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Choose from my ingredient requests for test ingredient",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Use Pitaya for test ingredient" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your recipe was not changed",
    );
    expect(onSelection).not.toHaveBeenCalled();
    expect(search).toHaveValue("almond");
    expect(screen.getByText("Pecan", { selector: ".ingredient-picker__selection strong" })).toBeVisible();
  });

  it("does not let an older resolution check overwrite a newer catalog choice", async () => {
    const detail = deferred<MemberIngredientRequest>();
    mocks.fetchMyIngredientRequest.mockReturnValue(detail.promise);
    mocks.searchCatalogIngredients.mockResolvedValue(page());
    const onSelection = vi.fn();
    render(<PickerHarness onSelection={onSelection} />);

    const search = screen.getByRole("searchbox", { name: "Ingredient" });
    fireEvent.change(search, { target: { value: "White sugar" } });
    fireEvent.keyDown(search, { key: "Enter" });
    const catalogResults = await screen.findByRole("list", {
      name: "Ingredient catalog results",
    });
    const catalogChoice = within(catalogResults).getByRole("button", {
      name: /white sugar/i,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Choose from my ingredient requests for test ingredient",
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Use Pitaya for test ingredient" }),
    );
    fireEvent.click(catalogChoice);

    await act(async () => {
      detail.resolve(approvedRequest());
      await detail.promise;
    });

    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(onSelection).toHaveBeenCalledWith({
      ingredientId: SUGAR_ID,
      canonicalName: "Granulated sugar",
      displayName: "White sugar",
    });
    expect(
      screen.getByText("White sugar", { selector: ".ingredient-picker__selection strong" }),
    ).toBeVisible();
    expect(screen.queryByText("Pitaya", { selector: ".ingredient-picker__selection strong" })).not.toBeInTheDocument();
  });

  it("preserves an unfinished missing-ingredient request while checking history", async () => {
    mocks.searchCatalogIngredients.mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    render(<PickerHarness />);

    const search = screen.getByRole("searchbox", { name: "Ingredient" });
    fireEvent.change(search, { target: { value: "Dragon fruit" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await screen.findByText(/no catalog ingredients match/i);
    fireEvent.click(screen.getByRole("button", { name: "Request a missing ingredient" }));
    fireEvent.change(screen.getByLabelText("Short context (optional)"), {
      target: { value: "Pink flesh with tiny black seeds" },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Choose from my ingredient requests for test ingredient",
      }),
    );
    await screen.findByRole("region", {
      name: "Choose from my ingredient requests for test ingredient",
    });
    expect(screen.getByLabelText("Proposed ingredient name")).toHaveValue("Dragon fruit");
    expect(screen.getByLabelText("Short context (optional)")).toHaveValue(
      "Pink flesh with tiny black seeds",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Hide my ingredient requests for test ingredient",
      }),
    );
    expect(screen.getByLabelText("Proposed ingredient name")).toHaveValue("Dragon fruit");
    expect(screen.getByLabelText("Short context (optional)")).toHaveValue(
      "Pink flesh with tiny black seeds",
    );
  });
});
