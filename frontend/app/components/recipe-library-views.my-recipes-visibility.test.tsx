import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import {
  authenticated,
  cleanupRecipeLibraryViewMocks,
  original,
  ROOT_ID,
} from "./recipe-library-views-test-support";
import { MyRecipeLibrary } from "./my-recipe-library";
afterEach(cleanupRecipeLibraryViewMocks);

describe("cook profile and private recipe libraries", () => {
  it("moves a withdrawn recipe out of Published and keeps the success announcement", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const publicPage = {
      items: [
        {
          kind: "published",
          recipe: original(),
          visibility_state: "published",
        },
      ],
      page: 1,
      page_size: 12,
      total: 1,
      total_pages: 1,
    };
    const emptyPublishedPage = {
      items: [],
      page: 1,
      page_size: 12,
      total: 0,
      total_pages: 0,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(publicPage))
      .mockResolvedValueOnce(
        Response.json({
          recipe_version_id: ROOT_ID,
          state: "author_withdrawn",
          updated_at: "2026-08-25T13:00:00Z",
        }),
      )
      .mockResolvedValueOnce(Response.json(emptyPublishedPage));
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<MyRecipeLibrary pageNumber={1} view="published" />);

    const list = await screen.findByRole("list", { name: "Published recipes" });
    expect(
      within(list).getByRole("link", { name: "Alice’s tomato soup" }),
    ).toBeVisible();
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Withdraw Alice’s tomato soup",
      }),
    );
    expect(
      within(list).getByText(/existing public versions remain available/i),
    ).toBeVisible();
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Confirm withdrawal of Alice’s tomato soup",
      }),
    );

    const visibilityPath = `/api/recipes/${ROOT_ID}/visibility`;
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([target]) => target === visibilityPath),
      ).toBe(true),
    );
    const visibilityCall = fetchMock.mock.calls.find(
      ([target]) => target === visibilityPath,
    );
    expect(visibilityCall?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ state: "author_withdrawn" }),
    });
    expect(new Headers(visibilityCall?.[1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-value",
    );
    const completion = await screen.findByRole("status");
    expect(completion).toHaveTextContent(
      "Alice’s tomato soup moved to Withdrawn.",
    );
    expect(completion).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(completion).toHaveFocus());
    expect(
      screen.getByRole("heading", {
        name: "You have no published recipes yet.",
      }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/my/recipes?view=published&page=1&page_size=12",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("moves a restored recipe out of Withdrawn and keeps the success announcement", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const withdrawnPage = {
      items: [
        {
          kind: "published",
          recipe: original(),
          visibility_state: "author_withdrawn",
        },
      ],
      page: 1,
      page_size: 12,
      total: 1,
      total_pages: 1,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(withdrawnPage))
      .mockResolvedValueOnce(
        Response.json({
          recipe_version_id: ROOT_ID,
          state: "published",
          updated_at: "2026-08-25T13:00:00Z",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [],
          page: 1,
          page_size: 12,
          total: 0,
          total_pages: 0,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<MyRecipeLibrary pageNumber={1} view="withdrawn" />);

    const list = await screen.findByRole("list", { name: "Withdrawn recipes" });
    const withdrawnHeader = screen
      .getByRole("heading", { level: 2, name: "Withdrawn recipes" })
      .closest("header");
    expect(withdrawnHeader).toHaveClass("workspace-panel-header");
    expect(withdrawnHeader).toHaveTextContent(
      "Withdrawn recipes are no longer public, but you can review or restore them here.",
    );
    expect(withdrawnHeader).toHaveTextContent("1 withdrawn recipe");
    const withdrawnCard = within(list).getByRole("article", {
      name: "Alice’s tomato soup",
    });
    expect(withdrawnCard).toHaveClass(
      "member-recipe-card",
      "member-recipe-card--withdrawn",
    );
    expect(
      within(withdrawnCard).getByText("Original", { exact: true }),
    ).toBeVisible();
    expect(within(withdrawnCard).queryByText("4 servings")).toBeNull();
    expect(
      within(withdrawnCard).getByText(/recipe-family history is preserved/i),
    ).toBeVisible();
    expect(
      within(list).queryByRole("link", { name: "Alice’s tomato soup" }),
    ).toBeNull();
    fireEvent.click(
      within(list).getByRole("button", { name: "Restore Alice’s tomato soup" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Alice’s tomato soup moved to Published.",
    );
    expect(
      screen.getByRole("heading", { name: "You have no withdrawn recipes." }),
    ).toBeVisible();
  });

  it("keeps visibility failures cook-facing without exposing service details", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const publicPage = {
      items: [
        {
          kind: "published",
          recipe: original(),
          visibility_state: "published",
        },
      ],
      page: 1,
      page_size: 12,
      total: 1,
      total_pages: 1,
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(publicPage))
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "visibility_service_unavailable",
                message:
                  "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
              },
            },
            { status: 503 },
          ),
        ),
    );
    authenticated(<MyRecipeLibrary pageNumber={1} view="published" />);

    const list = await screen.findByRole("list", { name: "Published recipes" });
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Withdraw Alice’s tomato soup",
      }),
    );
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Confirm withdrawal of Alice’s tomato soup",
      }),
    );

    expect(await within(list).findByRole("alert")).toHaveTextContent(
      "Recipe Lab could not change this recipe’s public visibility. Try again.",
    );
    expect(
      within(list).queryByText(/99999999|canonical|uuid|operator|policy/i),
    ).toBeNull();
  });

  it("keeps a moderation-hidden snapshot discoverable without author controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [
            {
              kind: "published",
              recipe: original(),
              visibility_state: "moderation_hidden",
            },
          ],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        }),
      ),
    );
    authenticated(<MyRecipeLibrary pageNumber={1} view="published" />);

    const list = await screen.findByRole("list", { name: "Published recipes" });
    expect(within(list).getByText("Original", { exact: true })).toBeVisible();
    expect(
      within(list).getByText(/visibility cannot be changed here/i),
    ).toBeVisible();
    expect(
      within(list).queryByRole("link", { name: "Alice’s tomato soup" }),
    ).toBeNull();
    expect(within(list).queryByRole("button")).toBeNull();
  });

  it("moves focus into withdrawal confirmation and returns it on cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [
            {
              kind: "published",
              recipe: original(),
              visibility_state: "published",
            },
          ],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        }),
      ),
    );
    authenticated(<MyRecipeLibrary pageNumber={1} view="published" />);

    const list = await screen.findByRole("list", { name: "Published recipes" });
    const withdraw = within(list).getByRole("button", {
      name: "Withdraw Alice’s tomato soup",
    });
    withdraw.focus();
    fireEvent.click(withdraw);
    const confirm = within(list).getByRole("button", {
      name: "Confirm withdrawal of Alice’s tomato soup",
    });
    await waitFor(() => expect(confirm).toHaveFocus());

    const cancel = within(list).getByRole("button", {
      name: "Cancel withdrawal of Alice’s tomato soup",
    });
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(
        within(list).getByRole("button", {
          name: "Withdraw Alice’s tomato soup",
        }),
      ).toHaveFocus(),
    );
  });
});

