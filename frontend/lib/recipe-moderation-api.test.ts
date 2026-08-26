import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  browseRecipeModerationCases,
  fetchRecipeModerationCase,
  moderateRecipeCase,
  parseRecipeModerationCaseDetail,
  RecipeModerationApiError,
} from "./recipe-moderation-api";

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";
const MODERATOR_ID = "44444444-4444-4444-8444-444444444444";
const ACTION_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-08-26T12:00:00Z";

const summary = {
  recipe_version_id: RECIPE_ID,
  title: "Reported soup",
  author: { id: AUTHOR_ID, handle: "cook", display_name: "Recipe Cook" },
  status: "open" as const,
  visibility_state: "published" as const,
  reporter_count: 2,
  opened_at: NOW,
  last_reported_at: NOW,
  resolved_at: null,
};

const detail = {
  ...summary,
  reason_counts: [{ reason: "spam" as const, count: 2 }],
  reports: [{ id: REPORT_ID, reason: "spam" as const, details: "Repeated links", submitted_at: NOW }],
  reports_total: 1,
  reports_truncated: false,
  history: [{
    id: 1,
    action: "hide" as const,
    previous_status: "open" as const,
    status: "open" as const,
    visibility_state: "moderation_hidden" as const,
    private_note: "Reviewing links",
    occurred_at: NOW,
    actor: { id: MODERATOR_ID, handle: "moderator", display_name: "Morgan Moderator" },
  }],
  history_total: 1,
  history_truncated: false,
};

beforeEach(() => {
  document.cookie = "recipe_lab_csrf=test-token; path=/";
});

afterEach(() => {
  document.cookie = "recipe_lab_csrf=; Max-Age=0; path=/";
  vi.unstubAllGlobals();
});

describe("recipe moderation API", () => {
  it("parses bounded de-identified evidence and rejects reporter identity", () => {
    expect(parseRecipeModerationCaseDetail(detail, RECIPE_ID)).toMatchObject({
      recipe_version_id: RECIPE_ID,
      reporter_count: 2,
      reports: [{ reason: "spam", details: "Repeated links" }],
    });
    expect(() =>
      parseRecipeModerationCaseDetail(
        {
          ...detail,
          reports: [{ ...detail.reports[0], reporter_id: "private-reporter" }],
        },
        RECIPE_ID,
      ),
    ).toThrow(RecipeModerationApiError);
  });

  it("loads private queue/detail and sends protected moderation actions", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ items: [summary], page: 1, page_size: 20, total: 1, total_pages: 1 }),
      )
      .mockResolvedValueOnce(Response.json(detail))
      .mockResolvedValueOnce(
        Response.json({
          recipe_version_id: RECIPE_ID,
          action: "hide",
          changed: true,
          case_status: "open",
          visibility_state: "moderation_hidden",
          acted_at: NOW,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(browseRecipeModerationCases({ status: "open" })).resolves.toMatchObject({ total: 1 });
    await expect(fetchRecipeModerationCase(RECIPE_ID)).resolves.toMatchObject({ title: "Reported soup" });
    await expect(
      moderateRecipeCase(RECIPE_ID, "hide", "  Private reason  ", ACTION_ID),
    ).resolves.toMatchObject({ visibility_state: "moderation_hidden" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/moderation/recipe-reports?status=open&page=1&page_size=20",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/moderation/recipe-reports/${RECIPE_ID}`);
    expect(fetchMock.mock.calls[2]).toEqual([
      `/api/moderation/recipe-reports/${RECIPE_ID}/actions`,
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Idempotency-Key": ACTION_ID,
          "X-CSRF-Token": "test-token",
        }),
        body: JSON.stringify({ action: "hide", private_note: "  Private reason  " }),
      }),
    ]);
  });
});
