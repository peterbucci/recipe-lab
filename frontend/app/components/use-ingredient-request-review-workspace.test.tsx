import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  IngredientCatalogApiError,
  type IngredientCatalogReviewPage,
} from "../../lib/ingredient-catalog-api";
import { deferred } from "../../tests/support/deferred";
import {
  REQUEST_ID,
  reviewDetail,
  reviewItem,
  reviewPage,
} from "../../tests/support/ingredient-request-review";
import { useIngredientRequestReviewWorkspace } from "./use-ingredient-request-review-workspace";

const SECOND_REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  browse: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return {
    ...actual,
    browseIngredientCatalogReviewRequests: mocks.browse,
    fetchIngredientCatalogReviewDetail: mocks.detail,
  };
});

function authorizationError() {
  return new IngredientCatalogApiError(
    "Review access is no longer available.",
    403,
    "ingredient_review_forbidden",
  );
}

function requestSignal(
  mock: typeof mocks.browse | typeof mocks.detail,
  callIndex: number,
): AbortSignal {
  const call = mock.mock.calls[callIndex];
  const candidate =
    mock === mocks.browse
      ? (call?.[0] as { signal?: AbortSignal } | undefined)?.signal
      : (call?.[1] as AbortSignal | undefined);
  if (!candidate) throw new Error("Expected the hook to pass an AbortSignal.");
  return candidate;
}

function renderWorkspaceHook(onAuthorizationLost = vi.fn()) {
  return {
    onAuthorizationLost,
    ...renderHook(() =>
      useIngredientRequestReviewWorkspace(onAuthorizationLost),
    ),
  };
}

beforeEach(() => {
  mocks.browse.mockReset();
  mocks.detail.mockReset();
});

describe("useIngredientRequestReviewWorkspace", () => {
  it("recovers a failed queue load through an explicit reload", async () => {
    const recovered = reviewPage([], { page: 1 });
    mocks.browse
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce(recovered);

    const { result } = renderWorkspaceHook();

    await waitFor(() =>
      expect(result.current.queueError).toBe(
        "The ingredient review queue could not be loaded. Please try again.",
      ),
    );
    expect(result.current.queueLoading).toBe(false);
    expect(result.current.queue).toBeNull();

    act(() => result.current.reloadQueue());

    await waitFor(() => expect(result.current.queue).toEqual(recovered));
    expect(mocks.browse).toHaveBeenCalledTimes(2);
    expect(result.current.queueError).toBe("");
    expect(result.current.queueLoading).toBe(false);
  });

  it("recovers a failed detail load through an explicit refresh", async () => {
    const recovered = reviewDetail({ context: "Recovered review context." });
    mocks.browse.mockResolvedValue(reviewPage());
    mocks.detail
      .mockRejectedValueOnce(new Error("detail unavailable"))
      .mockResolvedValueOnce(recovered);

    const { result } = renderWorkspaceHook();

    await waitFor(() =>
      expect(result.current.detailError).toBe(
        "This ingredient request could not be loaded. Please try again.",
      ),
    );
    expect(result.current.selectedRequestId).toBe(REQUEST_ID);
    expect(result.current.detail).toBeNull();

    await act(async () => {
      await result.current.refreshDetail();
    });

    expect(mocks.detail).toHaveBeenCalledTimes(2);
    expect(result.current.detail).toEqual(recovered);
    expect(result.current.detailError).toBe("");
    expect(result.current.detailLoading).toBe(false);
  });

  it("reports authorization loss without presenting a queue error", async () => {
    mocks.browse.mockRejectedValue(authorizationError());
    const { onAuthorizationLost, result } = renderWorkspaceHook();

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledOnce());
    expect(result.current.queue).toBeNull();
    expect(result.current.selectedRequestId).toBeNull();
    expect(result.current.queueError).toBe("");
    expect(result.current.queueLoading).toBe(false);
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("reports authorization loss without presenting a detail error", async () => {
    mocks.browse.mockResolvedValue(reviewPage());
    mocks.detail.mockRejectedValue(authorizationError());
    const { onAuthorizationLost, result } = renderWorkspaceHook();

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledOnce());
    expect(result.current.selectedRequestId).toBe(REQUEST_ID);
    expect(result.current.detail).toBeNull();
    expect(result.current.detailError).toBe("");
    expect(result.current.detailLoading).toBe(false);
  });

  it("ignores an older queue response after a page change", async () => {
    const first = deferred<IngredientCatalogReviewPage>();
    const second = deferred<IngredientCatalogReviewPage>();
    const firstPage = reviewPage([reviewItem()], {
      page: 1,
      total: 2,
      total_pages: 2,
    });
    const secondPage = reviewPage(
      [
        reviewItem({
          id: SECOND_REQUEST_ID,
          proposed_name: "Saffron threads",
        }),
      ],
      { page: 2, total: 2, total_pages: 2 },
    );
    mocks.browse
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    mocks.detail.mockResolvedValue(
      reviewDetail({
        id: SECOND_REQUEST_ID,
        proposed_name: "Saffron threads",
      }),
    );

    const { result } = renderWorkspaceHook();
    await waitFor(() => expect(mocks.browse).toHaveBeenCalledOnce());
    const firstSignal = requestSignal(mocks.browse, 0);

    act(() => result.current.changePage(2));

    await waitFor(() => expect(mocks.browse).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      second.resolve(secondPage);
    });
    await waitFor(() =>
      expect(result.current.detail?.id).toBe(SECOND_REQUEST_ID),
    );

    await act(async () => {
      first.resolve(firstPage);
    });

    expect(result.current.queue).toEqual(secondPage);
    expect(result.current.selectedRequestId).toBe(SECOND_REQUEST_ID);
    expect(result.current.detail?.id).toBe(SECOND_REQUEST_ID);
  });

  it("ignores an older detail response after the selection changes", async () => {
    const first = deferred<ReturnType<typeof reviewDetail>>();
    const second = deferred<ReturnType<typeof reviewDetail>>();
    mocks.browse.mockResolvedValue(
      reviewPage([
        reviewItem(),
        reviewItem({
          id: SECOND_REQUEST_ID,
          proposed_name: "Saffron threads",
        }),
      ]),
    );
    mocks.detail
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderWorkspaceHook();
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledOnce());
    const firstSignal = requestSignal(mocks.detail, 0);

    act(() => result.current.selectRequest(SECOND_REQUEST_ID));

    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);

    await act(async () => {
      second.resolve(
        reviewDetail({
          id: SECOND_REQUEST_ID,
          proposed_name: "Saffron threads",
        }),
      );
    });
    await waitFor(() =>
      expect(result.current.detail?.id).toBe(SECOND_REQUEST_ID),
    );

    await act(async () => {
      first.resolve(reviewDetail());
    });

    expect(result.current.selectedRequestId).toBe(SECOND_REQUEST_ID);
    expect(result.current.detail?.id).toBe(SECOND_REQUEST_ID);
  });

  it("aborts an in-flight queue request when unmounted", async () => {
    const pending = deferred<IngredientCatalogReviewPage>();
    mocks.browse.mockReturnValue(pending.promise);

    const { onAuthorizationLost, unmount } = renderWorkspaceHook();
    await waitFor(() => expect(mocks.browse).toHaveBeenCalledOnce());
    const signal = requestSignal(mocks.browse, 0);

    unmount();

    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.reject(authorizationError());
    });
    expect(onAuthorizationLost).not.toHaveBeenCalled();
  });

  it("aborts detail work and ignores a late failure after unmount", async () => {
    const pending = deferred<ReturnType<typeof reviewDetail>>();
    mocks.browse.mockResolvedValue(reviewPage());
    mocks.detail.mockReturnValue(pending.promise);

    const { onAuthorizationLost, unmount } = renderWorkspaceHook();
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledOnce());
    const queueSignal = requestSignal(mocks.browse, 0);
    const detailSignal = requestSignal(mocks.detail, 0);

    unmount();

    expect(queueSignal.aborted).toBe(true);
    expect(detailSignal.aborted).toBe(true);
    await act(async () => {
      pending.reject(authorizationError());
    });
    expect(onAuthorizationLost).not.toHaveBeenCalled();
  });
});
