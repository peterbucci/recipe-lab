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
  it("keeps facade-created failure outcomes consistent with the transport", () => {
    expect(new RecipeReportApiError("Rejected", 422).outcome).toBe("rejected");
    expect(new RecipeReportApiError("Unknown", 408).outcome).toBe("unknown");
    expect(new RecipeReportApiError("Unknown", 503).outcome).toBe("unknown");
  });

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
        {
          reason: "dangerous_content",
          details: "  Unsafe temperature guidance.  ",
        },
        ACTION_ID,
      ),
    ).resolves.toMatchObject({ id: REPORT_ID });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(target).toBe(`/api/recipes/${RECIPE_ID}/reports`);
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      body: JSON.stringify({
        reason: "dangerous_content",
        details: "Unsafe temperature guidance.",
      }),
    });
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe(ACTION_ID);
    expect(headers.get("X-CSRF-Token")).toBe("test-token");
  });

  it("accepts an exact 200 replay and normalizes omitted details", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { id: REPORT_ID, recipe_version_id: RECIPE_ID, submitted_at: SUBMITTED_AT },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const receipt = await submitRecipeReport(
      RECIPE_ID,
      { reason: "spam" },
      ACTION_ID,
    );

    expect(receipt).toEqual({
      id: REPORT_ID,
      recipe_version_id: RECIPE_ID,
      submitted_at: SUBMITTED_AT,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ reason: "spam", details: null }),
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
            {
              correlation_id: "private-correlation",
              error: {
                code: "rate_limited",
                message: "Private limiter detail",
                issues: [{ location: ["private"], message: "Private issue" }],
                future_field: true,
              },
            },
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
      outcome: "unknown",
      message: "Recipe Lab could not submit this report. Please try again.",
    });
    expect(`${String(unavailable)} ${JSON.stringify(unavailable)}`).not.toMatch(
      /99999999|canonical|uuid|operator|policy/i,
    );
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it("normalizes missing CSRF into a definite facade error before dispatch", async () => {
    document.cookie = "recipe_lab_csrf=; Max-Age=0; path=/";
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const error = await submitRecipeReport(
      RECIPE_ID,
      { reason: "spam", details: null },
      ACTION_ID,
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RecipeReportApiError);
    expect(error).toMatchObject({
      authenticationRecovery: "sign_in",
      code: "csrf_token_unavailable",
      outcome: "rejected",
      status: 401,
    });
    expect(expired).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it("rejects an unusable action key before dispatch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitRecipeReport(RECIPE_ID, { reason: "spam", details: null }, "  "),
    ).rejects.toMatchObject({
      code: "invalid_idempotency_key",
      outcome: "rejected",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes a network result as unknown without retrying automatically", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("private network detail"));
    vi.stubGlobal("fetch", fetchMock);

    const error = await submitRecipeReport(
      RECIPE_ID,
      { reason: "spam", details: null },
      ACTION_ID,
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RecipeReportApiError);
    expect(error).toMatchObject({
      code: "network_error",
      outcome: "unknown",
      status: 0,
    });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(
      "private network detail",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    new Response("not-json", { status: 201 }),
    Response.json(
      {
        id: REPORT_ID,
        recipe_version_id: RECIPE_ID,
        submitted_at: SUBMITTED_AT,
        reporter_id: "private-member-id",
      },
      { status: 201 },
    ),
    new Response(null, { status: 204 }),
  ])("treats an invalid success receipt as an ambiguous result", async (response) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);

    const error = await submitRecipeReport(
      RECIPE_ID,
      { reason: "spam", details: null },
      ACTION_ID,
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RecipeReportApiError);
    expect(error).toMatchObject({
      code: "invalid_recipe_report_response",
      outcome: "unknown",
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
