import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MemberIngredientRequest,
  MemberIngredientRequestPage,
} from "../../lib/ingredient-catalog-api";
import {
  browseMyIngredientRequests,
  fetchMyIngredientRequest,
  IngredientCatalogApiError,
} from "../../lib/ingredient-catalog-api";
import { MemberIngredientRequestHistory } from "./member-ingredient-request-history";

const mocks = vi.hoisted(() => ({
  browseMyIngredientRequests: vi.fn(),
  fetchMyIngredientRequest: vi.fn(),
}));

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return {
    ...actual,
    browseMyIngredientRequests: mocks.browseMyIngredientRequests,
    fetchMyIngredientRequest: mocks.fetchMyIngredientRequest,
  };
});

const PITAYA_ID = "11111111-1111-4111-8111-111111111111";
const PECAN_ID = "22222222-2222-4222-8222-222222222222";
const PENDING_ID = "33333333-3333-4333-8333-333333333333";
const APPROVED_ID = "44444444-4444-4444-8444-444444444444";
const REJECTED_ID = "55555555-5555-4555-8555-555555555555";
const DUPLICATE_ID = "66666666-6666-4666-8666-666666666666";

function memberRequest(
  overrides: Partial<MemberIngredientRequest> = {},
): MemberIngredientRequest {
  return {
    id: PENDING_ID,
    proposed_name: "Unreviewed herb",
    context: "A tender market herb",
    status: "pending",
    created_at: "2026-08-24T18:00:00Z",
    reviewed_at: null,
    decision_reason: null,
    resolved_ingredient_id: null,
    resolved_ingredient: null,
    ...overrides,
  };
}

const approved = memberRequest({
  id: APPROVED_ID,
  proposed_name: "Dragon fruit request text",
  status: "approved",
  reviewed_at: "2026-08-24T19:00:00Z",
  decision_reason: "Added under its common catalog name.",
  resolved_ingredient_id: PITAYA_ID,
  resolved_ingredient: {
    id: PITAYA_ID,
    canonical_name: "Pitaya",
    aliases: ["Dragon fruit"],
  },
});

const rejected = memberRequest({
  id: REJECTED_ID,
  proposed_name: "Ambiguous powder",
  status: "rejected",
  reviewed_at: "2026-08-24T20:00:00Z",
  decision_reason: "Not enough information to identify it safely.",
});

const duplicate = memberRequest({
  id: DUPLICATE_ID,
  proposed_name: "Pecan nut request text",
  status: "duplicate",
  reviewed_at: "2026-08-24T21:00:00Z",
  decision_reason: "Already cataloged as Pecan.",
  resolved_ingredient_id: PECAN_ID,
  resolved_ingredient: {
    id: PECAN_ID,
    canonical_name: "Pecan",
    aliases: ["Pecan nut"],
  },
});

function requestPage(
  items: MemberIngredientRequest[] = [memberRequest(), approved, rejected, duplicate],
  overrides: Partial<MemberIngredientRequestPage> = {},
): MemberIngredientRequestPage {
  return {
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    total_pages: items.length > 0 ? 1 : 0,
    ...overrides,
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

beforeEach(() => {
  mocks.browseMyIngredientRequests.mockReset();
  mocks.fetchMyIngredientRequest.mockReset();
  mocks.browseMyIngredientRequests.mockResolvedValue(requestPage());
});

describe("MemberIngredientRequestHistory", () => {
  it("shows every member status and terminal detail without exposing page-level selection", async () => {
    render(<MemberIngredientRequestHistory idPrefix="history" />);

    const region = await screen.findByRole("region", { name: "My ingredient requests" });
    expect(region).toHaveClass("member-request-history--standalone");
    expect(region).not.toHaveClass("member-request-history--picker");
    expect(within(region).getByRole("combobox", { name: "Request status" })).toHaveValue("");
    expect(
      within(region).getByRole("searchbox", { name: "Search my ingredient requests" }),
    ).toBeVisible();

    for (const name of [
      "Unreviewed herb",
      "Dragon fruit request text",
      "Ambiguous powder",
      "Pecan nut request text",
    ]) {
      expect(
        within(region).getByRole("article", { name: `Ingredient request: ${name}` }),
      ).toBeVisible();
    }

    const approvedCard = within(region).getByRole("article", {
      name: "Ingredient request: Dragon fruit request text",
    });
    expect(within(approvedCard).getByText("Added under its common catalog name.")).toBeVisible();
    expect(within(approvedCard).getByText("Pitaya", { selector: "strong" })).toBeVisible();
    expect(
      approvedCard.querySelector('time[datetime="2026-08-24T19:00:00Z"]'),
    ).not.toBeNull();

    const pendingCard = within(region).getByRole("article", {
      name: "Ingredient request: Unreviewed herb",
    });
    expect(within(pendingCard).getByText(/proposed text is not a catalog ingredient/i)).toBeVisible();
    const rejectedCard = within(region).getByRole("article", {
      name: "Ingredient request: Ambiguous powder",
    });
    expect(within(rejectedCard).getByText(/cannot be selected in a recipe/i)).toBeVisible();
    expect(within(region).queryByRole("button", { name: /^Use / })).not.toBeInTheDocument();
    expect(within(region).getAllByText(/available from an ingredient picker/i)).toHaveLength(2);
  });

  it("sends status, search, and paging to the complete member-history endpoint", async () => {
    mocks.browseMyIngredientRequests.mockImplementation(
      async ({ page = 1 }: { page?: number } = {}) =>
        requestPage([approved], {
          page,
          page_size: 20,
          total: 11,
          total_pages: 2,
        }),
    );
    render(<MemberIngredientRequestHistory idPrefix="history" />);
    await screen.findByRole("article", {
      name: "Ingredient request: Dragon fruit request text",
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Request status" }), {
      target: { value: "approved" },
    });
    await waitFor(() =>
      expect(browseMyIngredientRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "approved", page: 1, query: "" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Search requests" })).toBeEnabled(),
    );
    const search = screen.getByRole("searchbox", { name: "Search my ingredient requests" });
    fireEvent.change(search, { target: { value: "  dragon fruit  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search requests" }));

    await waitFor(() =>
      expect(browseMyIngredientRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "approved",
          page: 1,
          pageSize: 20,
          query: "dragon fruit",
        }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Next →" }));
    await waitFor(() =>
      expect(browseMyIngredientRequests).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "approved", page: 2, query: "dragon fruit" }),
      ),
    );
  });

  it("keeps keyboard focus on navigation controls while refreshed results load", async () => {
    const filtered = deferred<MemberIngredientRequestPage>();
    const searched = deferred<MemberIngredientRequestPage>();
    const nextPage = deferred<MemberIngredientRequestPage>();
    const firstPage = requestPage([approved], { total: 21, total_pages: 2 });
    mocks.browseMyIngredientRequests
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(filtered.promise)
      .mockReturnValueOnce(searched.promise)
      .mockReturnValueOnce(nextPage.promise);
    render(<MemberIngredientRequestHistory idPrefix="history" />);

    const region = await screen.findByRole("region", { name: "My ingredient requests" });
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    const status = screen.getByRole("combobox", { name: "Request status" });
    status.focus();
    fireEvent.change(status, { target: { value: "approved" } });
    expect(status).toHaveFocus();
    expect(status).toBeEnabled();
    expect(region).toHaveAttribute("aria-busy", "true");
    await act(async () => {
      filtered.resolve(firstPage);
      await filtered.promise;
    });
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    expect(status).toHaveFocus();

    const search = screen.getByRole("searchbox", { name: "Search my ingredient requests" });
    search.focus();
    fireEvent.change(search, { target: { value: "pitaya" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(search).toHaveFocus();
    expect(search).toBeEnabled();
    await act(async () => {
      searched.resolve(firstPage);
      await searched.promise;
    });
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    expect(search).toHaveFocus();

    const next = screen.getByRole("button", { name: "Next →" });
    next.focus();
    fireEvent.click(next);
    expect(next).toHaveFocus();
    expect(next).toBeEnabled();
    await act(async () => {
      nextPage.resolve(
        requestPage([duplicate], { page: 2, total: 21, total_pages: 2 }),
      );
      await nextPage.promise;
    });
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    expect(next).toHaveFocus();
  });

  it("refetches a trusted resolution before explicitly selecting its canonical identity", async () => {
    const detail = deferred<MemberIngredientRequest>();
    mocks.fetchMyIngredientRequest.mockReturnValue(detail.promise);
    const onSelectResolution = vi.fn();
    render(
      <MemberIngredientRequestHistory
        idPrefix="picker-history"
        contextLabel="Ingredient 2: Walnuts"
        onSelectResolution={onSelectResolution}
      />,
    );

    const region = await screen.findByRole("region", {
      name: "Choose from my ingredient requests for Ingredient 2: Walnuts",
    });
    expect(region).toHaveClass("member-request-history--picker");
    expect(region).not.toHaveClass("member-request-history--standalone");
    expect(
      within(
        within(region).getByRole("article", { name: "Ingredient request: Unreviewed herb" }),
      ).queryByRole("button", { name: /^Use / }),
    ).not.toBeInTheDocument();
    expect(
      within(
        within(region).getByRole("article", { name: "Ingredient request: Ambiguous powder" }),
      ).queryByRole("button", { name: /^Use / }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(region).getByRole("button", {
        name: "Use Pitaya for Ingredient 2: Walnuts",
      }),
    );
    expect(fetchMyIngredientRequest).toHaveBeenCalledWith(APPROVED_ID, expect.any(AbortSignal));
    expect(onSelectResolution).not.toHaveBeenCalled();
    expect(
      within(region).getByRole("button", { name: "Confirming Pitaya…" }),
    ).toBeDisabled();

    await act(async () => {
      detail.resolve(approved);
      await detail.promise;
    });
    expect(onSelectResolution).toHaveBeenCalledWith({
      ingredientId: PITAYA_ID,
      canonicalName: "Pitaya",
      displayName: "Pitaya",
    });
  });

  it("leaves the caller untouched when a resolution changed or could not be confirmed", async () => {
    mocks.fetchMyIngredientRequest.mockResolvedValue({
      ...approved,
      status: "duplicate",
      resolved_ingredient_id: PECAN_ID,
      resolved_ingredient: duplicate.resolved_ingredient,
    });
    const onSelectResolution = vi.fn();
    render(
      <MemberIngredientRequestHistory
        idPrefix="picker-history"
        contextLabel="New ingredient 4"
        onSelectResolution={onSelectResolution}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Use Pitaya for New ingredient 4" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This request changed since it was loaded. Your recipe was not changed.",
    );
    expect(onSelectResolution).not.toHaveBeenCalled();
  });

  it("keeps the caller untouched when detail confirmation fails", async () => {
    mocks.fetchMyIngredientRequest.mockRejectedValue(new Error("offline"));
    const onSelectResolution = vi.fn();
    render(
      <MemberIngredientRequestHistory
        idPrefix="picker-history"
        contextLabel="New ingredient 4"
        onSelectResolution={onSelectResolution}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Use Pitaya for New ingredient 4" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t confirm this catalog resolution. Your recipe was not changed.",
    );
    expect(onSelectResolution).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Use Pitaya for New ingredient 4" }),
    ).toBeEnabled();
  });

  it("keeps an expired-session failure local and offers draft-safe recovery", async () => {
    mocks.fetchMyIngredientRequest.mockRejectedValue(
      new IngredientCatalogApiError("Sign in again.", 401, "authentication_required"),
    );
    const onSelectResolution = vi.fn();
    render(
      <MemberIngredientRequestHistory
        idPrefix="picker-history"
        contextLabel="New ingredient 4"
        onSelectResolution={onSelectResolution}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Use Pitaya for New ingredient 4" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session expired. Your recipe was not changed.",
    );
    expect(screen.getByRole("link", { name: "Sign in in a new tab" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByText(/keep this recipe tab open/i)).toBeVisible();
    expect(onSelectResolution).not.toHaveBeenCalled();
  });

  it("recovers from a list-service error and then renders the empty state", async () => {
    mocks.browseMyIngredientRequests
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(requestPage([]));
    render(<MemberIngredientRequestHistory idPrefix="history" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your ingredient requests could not be loaded. Please try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("heading", { name: "No matching requests" })).toBeVisible();
    expect(screen.getByText(/requests you submit from an ingredient picker/i)).toBeVisible();
  });

  it("disables resolution actions while refreshed list data is pending", async () => {
    const refresh = deferred<MemberIngredientRequestPage>();
    mocks.browseMyIngredientRequests
      .mockResolvedValueOnce(requestPage())
      .mockReturnValueOnce(refresh.promise);
    render(
      <MemberIngredientRequestHistory
        idPrefix="picker-history"
        contextLabel="New ingredient 4"
        onSelectResolution={vi.fn()}
      />,
    );

    const useButton = await screen.findByRole("button", {
      name: "Use Pitaya for New ingredient 4",
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh my requests" }));
    expect(useButton).toBeDisabled();

    await act(async () => {
      refresh.resolve(requestPage());
      await refresh.promise;
    });
    expect(useButton).toBeEnabled();
  });
});
