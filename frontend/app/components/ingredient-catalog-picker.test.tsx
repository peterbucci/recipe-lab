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
  IngredientCatalogApiError,
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

function page(overrides: Partial<CatalogIngredientPage> = {}): CatalogIngredientPage {
  return {
    items: [
      {
        id: SUGAR_ID,
        canonical_name: "Granulated sugar",
        aliases: ["Caster sugar", "White sugar"],
      },
    ],
    page: 1,
    page_size: 8,
    total: 1,
    total_pages: 1,
    ...overrides,
  };
}

function request(proposedName = "Dragon fruit"): MissingIngredientRequest {
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
  disabled = false,
  initialValue = null,
  onRequest,
  onSelection,
}: {
  disabled?: boolean;
  initialValue?: CatalogIngredientSelection | null;
  onRequest?: (request: MissingIngredientRequest) => void;
  onSelection?: (selection: CatalogIngredientSelection | null) => void;
}) {
  const [selection, setSelection] = useState(initialValue);
  return (
    <IngredientCatalogPicker
      idPrefix="test-ingredient"
      contextLabel="test ingredient"
      disabled={disabled}
      label="Ingredient"
      value={selection}
      onRequestSubmitted={onRequest}
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
  mocks.searchCatalogIngredients.mockResolvedValue(page());
});

describe("IngredientCatalogPicker", () => {
  it("offers an accessible alias autocomplete and selects only with Enter", async () => {
    const lookup = deferred<CatalogIngredientPage>();
    vi.mocked(searchCatalogIngredients).mockReturnValue(lookup.promise);
    const onSelection = vi.fn();
    render(<PickerHarness onSelection={onSelection} />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.change(input, { target: { value: "White sugar" } });

    await waitFor(() => expect(searchCatalogIngredients).toHaveBeenCalledOnce());
    expect(searchCatalogIngredients).toHaveBeenCalledWith(
      expect.objectContaining({ query: "White sugar", page: 1, pageSize: 8 }),
    );
    expect(input).toHaveAttribute("aria-busy", "true");
    expect(onSelection).not.toHaveBeenCalled();

    await act(async () => {
      lookup.resolve(page());
      await lookup.promise;
    });

    const suggestions = screen.getByRole("listbox", { name: "Ingredient suggestions" });
    const option = within(suggestions).getByRole("option", { name: /white sugar/i });
    expect(option).toHaveTextContent("Catalog name: Granulated sugar");
    expect(input).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "test-ingredient-option-0");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelection).toHaveBeenLastCalledWith({
      ingredientId: SUGAR_ID,
      canonicalName: "Granulated sugar",
      displayName: "White sugar",
    });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("White sugar");
    expect(screen.getByText("Selected ingredient")).toBeVisible();
    expect(document.body).not.toHaveTextContent(SUGAR_ID);
  });

  it("wraps arrow navigation and closes suggestions with Escape", async () => {
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({
        items: [
          { id: SUGAR_ID, canonical_name: "Walnut", aliases: [] },
          { id: PECAN_ID, canonical_name: "Pecan", aliases: [] },
        ],
        total: 2,
      }),
    );
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "nut" } });
    await screen.findByRole("listbox", { name: "Ingredient suggestions" });

    input.focus();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", "test-ingredient-option-1");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox", { name: "Ingredient suggestions" })).toBeNull();
    expect(input).toHaveFocus();
    expect(input).toHaveValue("nut");
    expect(screen.getByRole("status")).toHaveTextContent("suggestions closed");
  });

  it("keeps the active keyboard suggestion in view", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({
        items: Array.from({ length: 8 }, (_, index) => ({
          id: `${index + 1}1111111-1111-4111-8111-111111111111`,
          canonical_name: `Nut ${index + 1}`,
          aliases: [],
        })),
        total: 8,
      }),
    );

    try {
      render(<PickerHarness />);
      const input = screen.getByRole("combobox", { name: "Ingredient" });
      fireEvent.change(input, { target: { value: "nut" } });
      await screen.findByRole("listbox", { name: "Ingredient suggestions" });

      for (let index = 0; index < 8; index += 1) {
        fireEvent.keyDown(input, { key: "ArrowDown" });
      }

      await waitFor(() =>
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" }),
      );
      expect(input).toHaveAttribute("aria-activedescendant", "test-ingredient-option-7");
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView,
        });
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  it("cancels an in-flight lookup when Escape dismisses autocomplete", async () => {
    const lookup = deferred<CatalogIngredientPage>();
    vi.mocked(searchCatalogIngredients).mockReturnValue(lookup.promise);
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "pecan" } });
    await waitFor(() => expect(searchCatalogIngredients).toHaveBeenCalledOnce());
    const signal = vi.mocked(searchCatalogIngredients).mock.calls[0]?.[0]?.signal;

    fireEvent.keyDown(input, { key: "Escape" });

    expect(signal?.aborted).toBe(true);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("pecan");
    expect(screen.getByRole("status")).toHaveTextContent("suggestions closed");

    await act(async () => {
      lookup.resolve(page());
      await lookup.promise;
    });
    expect(screen.queryByRole("listbox", { name: "Ingredient suggestions" })).toBeNull();
  });

  it("aborts and closes autocomplete when the editor becomes disabled", async () => {
    const lookup = deferred<CatalogIngredientPage>();
    vi.mocked(searchCatalogIngredients).mockReturnValue(lookup.promise);
    const onSelection = vi.fn();
    const { rerender } = render(
      <PickerHarness disabled={false} onSelection={onSelection} />,
    );

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "pecan" } });
    await waitFor(() => expect(searchCatalogIngredients).toHaveBeenCalledOnce());
    const signal = vi.mocked(searchCatalogIngredients).mock.calls[0]?.[0]?.signal;

    rerender(<PickerHarness disabled onSelection={onSelection} />);

    expect(signal?.aborted).toBe(true);
    expect(input).toBeDisabled();
    await act(async () => {
      lookup.resolve(page());
      await lookup.promise;
    });
    expect(screen.queryByRole("listbox", { name: "Ingredient suggestions" })).toBeNull();
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("aborts an older lookup and ignores its stale response", async () => {
    const staleLookup = deferred<CatalogIngredientPage>();
    vi.mocked(searchCatalogIngredients)
      .mockReturnValueOnce(staleLookup.promise)
      .mockResolvedValueOnce(page({ items: [], total: 0, total_pages: 0 }));
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "pecan" } });
    await waitFor(() => expect(searchCatalogIngredients).toHaveBeenCalledTimes(1));
    const firstSignal = vi.mocked(searchCatalogIngredients).mock.calls[0]?.[0]?.signal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);

    fireEvent.change(input, { target: { value: "dragon fruit" } });
    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => expect(searchCatalogIngredients).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No approved ingredients match dragon fruit.",
      ),
    );

    await act(async () => {
      staleLookup.resolve(
        page({ items: [{ id: PECAN_ID, canonical_name: "Pecan", aliases: [] }] }),
      );
      await staleLookup.promise;
    });
    expect(screen.queryByText("Pecan")).toBeNull();
    expect(input).toHaveValue("dragon fruit");
    expect(screen.getByRole("button", { name: "Request a missing ingredient" })).toBeVisible();
  });

  it("keeps the selected identity and typed query after a safe lookup failure", async () => {
    vi.mocked(searchCatalogIngredients).mockRejectedValue(
      new IngredientCatalogApiError(
        "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
        503,
      ),
    );
    render(
      <PickerHarness
        initialValue={{
          ingredientId: PECAN_ID,
          canonicalName: "Pecan",
          displayName: "Pecan",
        }}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "almond" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ingredient catalog could not be searched. Please try again.",
    );
    expect(screen.queryByText(/99999999|canonical|uuid|operator|policy/i)).toBeNull();
    expect(input).toHaveValue("almond");
    expect(screen.getByText("Selected ingredient")).toBeVisible();
    expect(screen.getByText("Pecan", { selector: "strong" })).toBeVisible();
  });

  it("submits missing text separately and preserves the rest of the picker", async () => {
    const unsafeName = '<img src=x onerror="alert(1)"> fruit';
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    vi.mocked(submitMissingIngredientRequest).mockResolvedValue(request(unsafeName));
    const onSelection = vi.fn();
    const onRequest = vi.fn();
    render(<PickerHarness onRequest={onRequest} onSelection={onSelection} />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: unsafeName } });
    await screen.findByText(/no approved ingredients match/i);
    fireEvent.click(screen.getByRole("button", { name: "Request a missing ingredient" }));

    expect(screen.getByLabelText("Proposed ingredient name")).toHaveFocus();
    expect(screen.getByLabelText("Proposed ingredient name")).toHaveValue(unsafeName);
    fireEvent.change(screen.getByLabelText("Short context (optional)"), {
      target: { value: "Seen at a neighborhood market" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit catalog request" }));

    await waitFor(() => expect(submitMissingIngredientRequest).toHaveBeenCalledOnce());
    expect(submitMissingIngredientRequest).toHaveBeenCalledWith({
      proposed_name: unsafeName,
      context: "Seen at a neighborhood market",
    });
    expect(document.querySelector("img")).toBeNull();
    expect(input).toHaveValue(unsafeName);
    expect(onSelection).not.toHaveBeenCalled();
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: REQUEST_ID, proposed_name: unsafeName, status: "pending" }),
    );
  });

  it("preserves unfinished request fields after a duplicate response", async () => {
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    vi.mocked(submitMissingIngredientRequest).mockRejectedValue(new Error("duplicate"));
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "Dragon fruit" } });
    await screen.findByText(/no approved ingredients match/i);
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

  it("selects a freshly confirmed request resolution and restores trigger focus", async () => {
    vi.mocked(searchCatalogIngredients).mockRejectedValueOnce(new Error("offline"));
    const onSelection = vi.fn();
    render(<PickerHarness onSelection={onSelection} />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "pitaya" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ingredient catalog could not be searched",
    );

    const trigger = screen.getByRole("button", {
      name: "Choose from my ingredient requests for test ingredient",
    });
    fireEvent.click(trigger);
    const region = await screen.findByRole("region", {
      name: "Choose from my ingredient requests for test ingredient",
    });
    fireEvent.click(
      await within(region).findByRole("button", { name: "Use Pitaya for test ingredient" }),
    );

    await waitFor(() =>
      expect(onSelection).toHaveBeenCalledWith({
        ingredientId: SUGAR_ID,
        canonicalName: "Pitaya",
        displayName: "Pitaya",
      }),
    );
    expect(fetchMyIngredientRequest).toHaveBeenCalledWith(REQUEST_ID, expect.any(AbortSignal));
    expect(region).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "Ingredient" })).toHaveValue("Pitaya");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the current selection and query when resolution confirmation fails", async () => {
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

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "almond" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Choose from my ingredient requests for test ingredient",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Use Pitaya for test ingredient" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your recipe was not changed");
    expect(onSelection).not.toHaveBeenCalled();
    expect(input).toHaveValue("almond");
    expect(screen.getByText("Pecan", { selector: ".ingredient-picker__selection strong" })).toBeVisible();
  });

  it("does not let an older resolution overwrite a newer autocomplete choice", async () => {
    const detail = deferred<MemberIngredientRequest>();
    mocks.fetchMyIngredientRequest.mockReturnValue(detail.promise);
    mocks.searchCatalogIngredients.mockResolvedValue(page());
    const onSelection = vi.fn();
    render(<PickerHarness onSelection={onSelection} />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "White sugar" } });
    await screen.findByRole("listbox", { name: "Ingredient suggestions" });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Choose from my ingredient requests for test ingredient",
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Use Pitaya for test ingredient" }));

    fireEvent.focus(input);
    const suggestions = await screen.findByRole("listbox", { name: "Ingredient suggestions" });
    fireEvent.click(within(suggestions).getByRole("option", { name: /white sugar/i }));

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
    expect(screen.getByText("White sugar", { selector: ".ingredient-picker__selection strong" })).toBeVisible();
    expect(screen.queryByText("Pitaya", { selector: ".ingredient-picker__selection strong" })).toBeNull();
  });

  it("preserves an unfinished missing-ingredient request while checking history", async () => {
    mocks.searchCatalogIngredients.mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.change(input, { target: { value: "Dragon fruit" } });
    await screen.findByText(/no approved ingredients match/i);
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
  });
});
