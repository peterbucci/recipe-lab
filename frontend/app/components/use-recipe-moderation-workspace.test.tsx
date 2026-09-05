import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RecipeModerationCaseDetail,
  RecipeModerationCasePage,
} from "../../lib/recipe-moderation-api";
import { RecipeModerationApiError } from "../../lib/recipe-moderation-api";
import { deferred } from "../../tests/support/deferred";
import {
  NOW,
  RECIPE_ID,
  SECOND_RECIPE_ID,
  moderationDetail,
  moderationPage,
  moderationSummary,
  secondModerationSummary,
} from "../../tests/support/recipe-moderation";
import { useRecipeModerationWorkspace } from "./use-recipe-moderation-workspace";

const mocks = vi.hoisted(() => ({
  browse: vi.fn(),
  detail: vi.fn(),
  key: vi.fn(),
  moderate: vi.fn(),
}));

vi.mock("../../lib/idempotency-key", () => ({ createIdempotencyKey: mocks.key }));
vi.mock("../../lib/recipe-moderation-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-moderation-api")>();
  return {
    ...actual,
    browseRecipeModerationCases: mocks.browse,
    fetchRecipeModerationCase: mocks.detail,
    moderateRecipeCase: mocks.moderate,
  };
});

function renderWorkspaceHook() {
  const onAuthorizationLost = vi.fn();
  const hook = renderHook(() =>
    useRecipeModerationWorkspace({ onAuthorizationLost }),
  );
  return { ...hook, onAuthorizationLost };
}

beforeEach(() => {
  mocks.browse.mockReset().mockResolvedValue(moderationPage());
  mocks.detail.mockReset().mockResolvedValue(moderationDetail());
  mocks.key.mockReset().mockReturnValue("moderation-key");
  mocks.moderate.mockReset().mockResolvedValue({
    recipe_version_id: RECIPE_ID,
    action: "hide",
    changed: true,
    case_status: "open",
    visibility_state: "moderation_hidden",
    acted_at: NOW,
  });
});

describe("useRecipeModerationWorkspace", () => {
  it("recovers from a queue failure when reloaded", async () => {
    mocks.browse
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce(moderationPage());
    const { result } = renderWorkspaceHook();

    await waitFor(() =>
      expect(result.current.queueError).toBe(
        "The recipe-report queue could not be loaded. Please try again.",
      ),
    );

    act(() => result.current.reloadQueue());
    await waitFor(() => expect(result.current.queue?.total).toBe(1));
    expect(result.current.queueError).toBe("");
  });

  it("recovers from a detail failure when reloaded", async () => {
    mocks.detail
      .mockRejectedValueOnce(new Error("detail unavailable"))
      .mockResolvedValueOnce(moderationDetail());
    const { result } = renderWorkspaceHook();

    await waitFor(() =>
      expect(result.current.detailError).toBe(
        "This moderation case could not be loaded. Please try again.",
      ),
    );

    act(() => result.current.reloadDetail());
    await waitFor(() => expect(result.current.detail?.recipe_version_id).toBe(RECIPE_ID));
    expect(result.current.detailError).toBe("");
  });

  it("reports authorization loss while loading the queue", async () => {
    mocks.browse.mockRejectedValueOnce(
      new RecipeModerationApiError("Moderator access expired.", 403),
    );
    const { onAuthorizationLost, result } = renderWorkspaceHook();

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledOnce());
    expect(result.current.queueError).toBe("");
  });

  it("reports authorization loss while loading a detail", async () => {
    mocks.detail.mockRejectedValueOnce(
      new RecipeModerationApiError("Moderator access expired.", 403),
    );
    const { onAuthorizationLost, result } = renderWorkspaceHook();

    await waitFor(() => expect(onAuthorizationLost).toHaveBeenCalledOnce());
    expect(result.current.detailError).toBe("");
  });

  it("ignores a stale queue response after the status changes", async () => {
    const first = deferred<RecipeModerationCasePage>();
    const second = deferred<RecipeModerationCasePage>();
    mocks.browse
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderWorkspaceHook();

    act(() => result.current.changeCaseStatus("resolved"));
    await waitFor(() => expect(mocks.browse).toHaveBeenCalledTimes(2));

    const resolvedSummary = {
      ...secondModerationSummary,
      status: "resolved" as const,
      resolved_at: NOW,
    };
    await act(async () => second.resolve(moderationPage([resolvedSummary])));
    await waitFor(() =>
      expect(result.current.queue?.items[0]?.recipe_version_id).toBe(
        SECOND_RECIPE_ID,
      ),
    );

    await act(async () => first.resolve(moderationPage([moderationSummary])));
    expect(result.current.queue?.items[0]?.recipe_version_id).toBe(
      SECOND_RECIPE_ID,
    );
  });

  it("ignores a stale detail response after another case is selected", async () => {
    const first = deferred<RecipeModerationCaseDetail>();
    const second = deferred<RecipeModerationCaseDetail>();
    mocks.browse.mockResolvedValueOnce(
      moderationPage([moderationSummary, secondModerationSummary]),
    );
    mocks.detail
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderWorkspaceHook();

    await waitFor(() => expect(mocks.detail).toHaveBeenCalledWith(RECIPE_ID, expect.any(AbortSignal)));
    act(() => result.current.selectCase(SECOND_RECIPE_ID));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));

    await act(async () =>
      second.resolve(
        moderationDetail({
          ...secondModerationSummary,
        }),
      ),
    );
    await waitFor(() =>
      expect(result.current.detail?.recipe_version_id).toBe(SECOND_RECIPE_ID),
    );

    await act(async () => first.resolve(moderationDetail()));
    expect(result.current.detail?.recipe_version_id).toBe(SECOND_RECIPE_ID);
  });

  it("aborts an in-flight queue request on unmount", () => {
    let signal: AbortSignal | undefined;
    mocks.browse.mockImplementationOnce(({ signal: requestSignal }) => {
      signal = requestSignal;
      return new Promise<RecipeModerationCasePage>(() => undefined);
    });
    const { unmount } = renderWorkspaceHook();

    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("aborts an in-flight detail request on unmount", async () => {
    let signal: AbortSignal | undefined;
    mocks.detail.mockImplementationOnce((_id, requestSignal) => {
      signal = requestSignal;
      return new Promise<RecipeModerationCaseDetail>(() => undefined);
    });
    const { unmount } = renderWorkspaceHook();

    await waitFor(() => expect(signal).toBeDefined());
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("preserves a failed action and reuses its idempotency key on retry", async () => {
    mocks.moderate
      .mockRejectedValueOnce(
        new RecipeModerationApiError("Moderation is temporarily unavailable.", 503),
      )
      .mockResolvedValueOnce({
        recipe_version_id: RECIPE_ID,
        action: "hide",
        changed: true,
        case_status: "open",
        visibility_state: "moderation_hidden",
        acted_at: NOW,
      });
    const { result } = renderWorkspaceHook();
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    act(() => result.current.changePrivateNote("  Private review note.  "));

    await act(async () => result.current.applyAction("hide"));
    expect(result.current.actionError).toBe(
      "Moderation is temporarily unavailable.",
    );
    expect(result.current.privateNote).toBe("  Private review note.  ");

    await act(async () => result.current.applyAction("hide"));
    expect(mocks.moderate).toHaveBeenNthCalledWith(
      1,
      RECIPE_ID,
      "hide",
      "Private review note.",
      "moderation-key",
    );
    expect(mocks.moderate).toHaveBeenNthCalledWith(
      2,
      RECIPE_ID,
      "hide",
      "Private review note.",
      "moderation-key",
    );
    expect(result.current.privateNote).toBe("");
    expect(result.current.workspaceStatus).toMatch(/^Recipe hidden\./);
  });

  it("reports authorization loss from an action and preserves its note", async () => {
    mocks.moderate.mockRejectedValueOnce(
      new RecipeModerationApiError("Moderator access expired.", 403),
    );
    const { onAuthorizationLost, result } = renderWorkspaceHook();
    await waitFor(() => expect(result.current.detail).not.toBeNull());
    act(() => result.current.changePrivateNote("Private review note."));

    await act(async () => result.current.applyAction("resolve"));

    expect(onAuthorizationLost).toHaveBeenCalledOnce();
    expect(result.current.privateNote).toBe("Private review note.");
    expect(result.current.actionError).toBe("");
  });
});
