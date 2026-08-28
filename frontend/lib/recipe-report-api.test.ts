import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  parseRecipeReportReceipt,
  RecipeReportApiError,
  submitRecipeReport,
} from "./recipe-report-api";

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "33333333-3333-4333-8333-333333333333";
const SUBMITTED_AT = "2026-08-26T12:00:00Z";

beforeEach(() => {
  document.cookie = "recipe_lab_csrf=test-token; path=/";
});

afterEach(() => {
  document.cookie = "recipe_lab_csrf=; Max-Age=0; path=/";
  vi.unstubAllGlobals();
});

describe("recipe report API", () => {
  it("accepts only the private receipt and rejects leaked reporter data", () => {
    expect(
      parseRecipeReportReceipt(
        { id: REPORT_ID, recipe_version_id: RECIPE_ID, submitted_at: SUBMITTED_AT },
        RECIPE_ID,
      ),
    ).toEqual({ id: REPORT_ID, recipe_version_id: RECIPE_ID, submitted_at: SUBMITTED_AT });
    expect(() =>
      parseRecipeReportReceipt(
        {
          id: REPORT_ID,
          recipe_version_id: RECIPE_ID,
          submitted_at: SUBMITTED_AT,
          reporter_id: "private-member-id",
        },
        RECIPE_ID,
      ),
    ).toThrow(RecipeReportApiError);
  });

  it("submits a bounded report with CSRF and idempotency protection", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { id: REPORT_ID, recipe_version_id: RECIPE_ID, submitted_at: SUBMITTED_AT },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitRecipeReport(
        RECIPE_ID,
        { reason: "dangerous_content", details: "Unsafe temperature guidance." },
        ACTION_ID,
      ),
    ).resolves.toMatchObject({ id: REPORT_ID });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipes/${RECIPE_ID}/reports`,
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Idempotency-Key": ACTION_ID,
          "X-CSRF-Token": "test-token",
        }),
        body: JSON.stringify({
          reason: "dangerous_content",
          details: "Unsafe temperature guidance.",
        }),
      }),
    );
  });

  it("uses Retry-After safely and expires the local session on 401", async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            { error: { code: "rate_limited", message: "Private limiter detail" } },
            { status: 429, headers: { "Retry-After": "12" } },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            { error: { code: "authentication_required", message: "Private identity detail" } },
            { status: 401 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "report_service_unavailable",
                message:
                  "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
              },
            },
            { status: 503 },
          ),
        ),
    );

    await expect(
      submitRecipeReport(RECIPE_ID, { reason: "spam", details: null }, ACTION_ID),
    ).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 12,
      message: "Too many reports were submitted. Try again in 12 seconds.",
    });
    await expect(
      submitRecipeReport(RECIPE_ID, { reason: "spam", details: null }, ACTION_ID),
    ).rejects.toMatchObject({
      status: 401,
      message: "Your session expired. Sign in again before reporting this recipe.",
    });
    const unavailable = await submitRecipeReport(
      RECIPE_ID,
      { reason: "spam", details: null },
      ACTION_ID,
    ).catch((reason: unknown) => reason);
    expect(unavailable).toMatchObject({
      status: 503,
      code: "report_service_unavailable",
      message: "Recipe Lab could not submit this report. Please try again.",
    });
    expect(`${String(unavailable)} ${JSON.stringify(unavailable)}`).not.toMatch(
      /99999999|canonical|uuid|operator|policy/i,
    );
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });
});
