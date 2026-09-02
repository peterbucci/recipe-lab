import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CatalogIngredientPage,
  CatalogIngredientSelection,
  MissingIngredientRequest,
} from "../../lib/ingredient-catalog-api";
import {
  IngredientCatalogApiError,
  searchCatalogIngredients,
  submitMissingIngredientRequest,
} from "../../lib/ingredient-catalog-api";
import type { RecipeDraftRequestSelection } from "../../lib/recipe-draft-api";
import { IngredientCatalogPicker } from "./ingredient-catalog-picker";

const mocks = vi.hoisted(() => ({
  browseMyIngredientRequests: vi.fn(),
  searchCatalogIngredients: vi.fn(),
  submitMissingIngredientRequest: vi.fn(),
}));

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return {
    ...actual,
    browseMyIngredientRequests: mocks.browseMyIngredientRequests,
    searchCatalogIngredients: mocks.searchCatalogIngredients,
    submitMissingIngredientRequest: mocks.submitMissingIngredientRequest,
  };
});

const SUGAR_ID = "11111111-1111-4111-8111-111111111111";
const PECAN_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";

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

function pendingRequest(
  proposedName = "Dragon fruit",
): RecipeDraftRequestSelection["request"] {
  return {
    id: REQUEST_ID,
    proposed_name: proposedName,
    status: "pending",
    resolved_ingredient: null,
  };
}

function submittedRequest(proposedName = "Dragon fruit"): MissingIngredientRequest {
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
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function PickerHarness({
  disabled = false,
  initialRequest = null,
  initialValue = null,
  onRequest,
  onSelection,
}: {
  disabled?: boolean;
  initialRequest?: RecipeDraftRequestSelection["request"] | null;
  initialValue?: CatalogIngredientSelection | null;
  onRequest?: (request: MissingIngredientRequest) => void;
  onSelection?: (selection: CatalogIngredientSelection | null) => void;
}) {
  const [selection, setSelection] = useState(initialValue);
  const [requestValue, setRequestValue] = useState(initialRequest);
  return (
    <IngredientCatalogPicker
      idPrefix="test-ingredient"
      contextLabel="test ingredient"
      disabled={disabled}
      label="Ingredient"
      requestValue={requestValue}
      value={selection}
      onRequestSubmitted={(request) => {
        setRequestValue({
          id: request.id,
          proposed_name: request.proposed_name,
          status: request.status,
          resolved_ingredient: null,
        });
        onRequest?.(request);
      }}
      onChange={(next) => {
        setSelection(next);
        setRequestValue(null);
        onSelection?.(next);
      }}
    />
  );
}

beforeEach(() => {
  mocks.browseMyIngredientRequests.mockReset();
  mocks.searchCatalogIngredients.mockReset();
  mocks.submitMissingIngredientRequest.mockReset();
  mocks.searchCatalogIngredients.mockResolvedValue(page());
  mocks.browseMyIngredientRequests.mockResolvedValue({
    items: [],
    page: 1,
    page_size: 8,
    total: 0,
    total_pages: 0,
  });
});

describe("IngredientCatalogPicker", () => {
  it("opens one accessible popup on focus with the request action at the bottom", () => {
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-expanded", "false");
    fireEvent.focus(input);

    expect(input).toHaveAttribute("aria-expanded", "true");
    const suggestions = screen.getByRole("listbox", { name: "Ingredient suggestions" });
    const popup = suggestions.parentElement as HTMLElement;
    const requestAction = within(popup).getByRole("button", {
      name: "Request missing ingredient",
    });
    expect(requestAction).toBeVisible();
    expect(popup.lastElementChild).toContainElement(requestAction);
    expect(screen.queryByText("Selected ingredient")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear ingredient" })).toBeNull();
    expect(screen.queryByRole("button", { name: /use a requested ingredient/i })).toBeNull();
  });

  it("searches aliases and selects an approved match with the keyboard", async () => {
    const lookup = deferred<CatalogIngredientPage>();
    vi.mocked(searchCatalogIngredients).mockReturnValue(lookup.promise);
    const onSelection = vi.fn();
    render(<PickerHarness onSelection={onSelection} />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "White sugar" } });
    await waitFor(() => expect(searchCatalogIngredients).toHaveBeenCalledOnce());
    expect(searchCatalogIngredients).toHaveBeenCalledWith(
      expect.objectContaining({ query: "White sugar", page: 1, pageSize: 8 }),
    );
    expect(input).toHaveAttribute("aria-busy", "true");
    const searchStatus = screen.getByRole("status");
    expect(searchStatus).toHaveTextContent("Searching ingredients…");
    expect(searchStatus).toHaveClass("inline-loading");

    await act(async () => {
      lookup.resolve(page());
      await lookup.promise;
    });

    const suggestions = screen.getByRole("listbox", { name: "Ingredient suggestions" });
    expect(within(suggestions).getByRole("option", { name: /white sugar/i })).toHaveTextContent(
      "Catalog name: Granulated sugar",
    );
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
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(document.body).not.toHaveTextContent(SUGAR_ID);
  });

  it("shows a matching pending request as unavailable information", async () => {
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    const onSelection = vi.fn();
    render(
      <PickerHarness initialRequest={pendingRequest()} onSelection={onSelection} />,
    );

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    const requestStatus = screen.getByText("Pending review", { selector: "span" });
    expect(input).not.toHaveClass("has-request-state");
    expect(input.closest(".ingredient-picker__combobox")).not.toContainElement(
      requestStatus,
    );
    fireEvent.focus(input);

    const pending = await screen.findByText("Dragon fruit", { selector: "strong" });
    const pendingRegion = screen.getByRole("region", {
      name: "Pending ingredient requests",
    });
    expect(pendingRegion).toContainElement(pending);
    expect(pendingRegion).toHaveTextContent(/pending review/i);
    expect(pendingRegion).toHaveTextContent(/not available yet/i);
    expect(within(pendingRegion).queryByRole("option")).toBeNull();
    expect(within(pendingRegion).queryByRole("button")).toBeNull();
    expect(onSelection).not.toHaveBeenCalled();
  });

  it("clears catalog identity when typing after a selection and preserves the query", async () => {
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
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "almond" } });

    expect(onSelection).toHaveBeenCalledOnce();
    expect(onSelection).toHaveBeenCalledWith(null);
    expect(input).toHaveValue("almond");
    await waitFor(() =>
      expect(searchCatalogIngredients).toHaveBeenCalledWith(
        expect.objectContaining({ query: "almond" }),
      ),
    );
    expect(input).toHaveValue("almond");
  });

  it("wraps keyboard navigation, keeps it in view, and Escape aborts the lookup", async () => {
    const lookup = deferred<CatalogIngredientPage>();
    vi.mocked(searchCatalogIngredients).mockReturnValue(lookup.promise);
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "nut" } });
    await waitFor(() => expect(searchCatalogIngredients).toHaveBeenCalledOnce());
    const signal = vi.mocked(searchCatalogIngredients).mock.calls[0]?.[0]?.signal;

    await act(async () => {
      lookup.resolve(
        page({
          items: [
            { id: SUGAR_ID, canonical_name: "Walnut", aliases: [] },
            { id: PECAN_ID, canonical_name: "Pecan", aliases: [] },
          ],
          total: 2,
        }),
      );
      await lookup.promise;
    });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", "test-ingredient-option-1");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });

    expect(signal?.aborted).toBe(true);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("nut");
    expect(screen.queryByRole("listbox", { name: "Ingredient suggestions" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("suggestions closed");
  });

  it("aborts an older lookup and ignores its stale response", async () => {
    const staleLookup = deferred<CatalogIngredientPage>();
    vi.mocked(searchCatalogIngredients)
      .mockReturnValueOnce(staleLookup.promise)
      .mockResolvedValueOnce(page({ items: [], total: 0, total_pages: 0 }));
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "pecan" } });
    await waitFor(() => expect(searchCatalogIngredients).toHaveBeenCalledTimes(1));
    const firstSignal = vi.mocked(searchCatalogIngredients).mock.calls[0]?.[0]?.signal;
    fireEvent.change(input, { target: { value: "dragon fruit" } });

    expect(firstSignal?.aborted).toBe(true);
    await waitFor(() => expect(searchCatalogIngredients).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "No ingredients match dragon fruit.",
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
    expect(screen.getByRole("button", { name: "Request missing ingredient" })).toBeVisible();
  });

  it("keeps the typed query and hides unsafe details after a lookup failure", async () => {
    vi.mocked(searchCatalogIngredients).mockRejectedValue(
      new IngredientCatalogApiError(
        "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
        503,
      ),
    );
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "almond" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ingredient catalog couldn’t be searched.",
    );
    expect(searchCatalogIngredients).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.queryByText(/99999999|canonical|uuid|operator|policy/i)).toBeNull();
    expect(input).toHaveValue("almond");
    expect(screen.getByRole("button", { name: "Request missing ingredient" })).toBeVisible();
  });

  it("retries a transient read once before showing any search error", async () => {
    vi.mocked(searchCatalogIngredients)
      .mockRejectedValueOnce(
        new IngredientCatalogApiError("temporary outage", 503),
      )
      .mockResolvedValueOnce(page());
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "sugar" } });

    expect(
      await screen.findByRole("option", { name: /granulated sugar/i }),
    ).toBeVisible();
    expect(searchCatalogIngredients).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps catalog matches when pending requests fail and recovers with one retry", async () => {
    mocks.browseMyIngredientRequests.mockRejectedValue(
      new IngredientCatalogApiError("private request service detail", 503),
    );
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "sugar" } });

    expect(
      await screen.findByRole("option", { name: /granulated sugar/i }),
    ).toBeVisible();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Pending ingredient requests couldn’t be checked.",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(
      screen.queryByText(/private request service detail/i),
    ).toBeNull();

    mocks.browseMyIngredientRequests.mockResolvedValue({
      items: [],
      page: 1,
      page_size: 8,
      total: 0,
      total_pages: 0,
    });
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(
      screen.getByRole("option", { name: /granulated sugar/i }),
    ).toBeVisible();
    expect(mocks.browseMyIngredientRequests).toHaveBeenCalledTimes(3);
  });

  it("collapses simultaneous service failures into one search-scoped alert", async () => {
    vi.mocked(searchCatalogIngredients).mockRejectedValue(
      new IngredientCatalogApiError("catalog detail", 503),
    );
    mocks.browseMyIngredientRequests.mockRejectedValue(
      new IngredientCatalogApiError("request detail", 504),
    );
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "almond" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Ingredient suggestions couldn’t be loaded.");
    expect(within(alert).getAllByRole("button", { name: "Try again" })).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(/catalog detail|request detail/i)).toBeNull();
    expect(searchCatalogIngredients).toHaveBeenCalledTimes(2);
    expect(mocks.browseMyIngredientRequests).toHaveBeenCalledTimes(2);
  });

  it("keeps a session failure separate from retryable search failures", async () => {
    mocks.browseMyIngredientRequests.mockRejectedValue(
      new IngredientCatalogApiError(
        "private authentication detail",
        401,
        "authentication_required",
      ),
    );
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "sugar" } });

    expect(
      await screen.findByRole("option", { name: /granulated sugar/i }),
    ).toBeVisible();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Your session expired. Sign in again to check pending ingredient requests.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText(/private authentication detail/i)).toBeNull();
    expect(mocks.browseMyIngredientRequests).toHaveBeenCalledOnce();
  });

  it("opens the request form as a modal and restores focus when it closes", async () => {
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Dragon fruit" } });
    await screen.findByText("No approved ingredients match.");
    const trigger = screen.getByRole("button", { name: "Request missing ingredient" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "Request a missing ingredient",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-describedby", "test-ingredient-request-summary");
    expect(screen.getByLabelText("Proposed ingredient name")).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(input).toHaveFocus());
    expect(document.body.style.overflow).toBe("");
  });

  it("closes the request modal and surfaces the submission as pending review", async () => {
    const unsafeName = '<img src=x onerror="alert(1)"> fruit';
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    vi.mocked(submitMissingIngredientRequest).mockResolvedValue(
      submittedRequest(unsafeName),
    );
    const onSelection = vi.fn();
    const onRequest = vi.fn();
    render(<PickerHarness onRequest={onRequest} onSelection={onSelection} />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: unsafeName } });
    await screen.findByText("No approved ingredients match.");
    fireEvent.click(screen.getByRole("button", { name: "Request missing ingredient" }));
    expect(
      screen.getByRole("dialog", { name: "Request a missing ingredient" }),
    ).toHaveAttribute("aria-modal", "true");
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
    await waitFor(() =>
      expect(screen.queryByLabelText("Proposed ingredient name")).toBeNull(),
    );
    expect(document.querySelector("img")).toBeNull();
    expect(input).toHaveValue(unsafeName);
    expect(onSelection).not.toHaveBeenCalled();
    expect(onRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: REQUEST_ID, proposed_name: unsafeName, status: "pending" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(/pending review/i);
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.focus(input);
    expect(screen.getByText(unsafeName, { selector: "strong" }).parentElement).toHaveTextContent(
      /not available yet/i,
    );
  });

  it("preserves unfinished request fields after a failed submission", async () => {
    vi.mocked(searchCatalogIngredients).mockResolvedValue(
      page({ items: [], total: 0, total_pages: 0 }),
    );
    vi.mocked(submitMissingIngredientRequest).mockRejectedValue(new Error("duplicate"));
    render(<PickerHarness />);

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Dragon fruit" } });
    await screen.findByText("No approved ingredients match.");
    fireEvent.click(screen.getByRole("button", { name: "Request missing ingredient" }));
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
