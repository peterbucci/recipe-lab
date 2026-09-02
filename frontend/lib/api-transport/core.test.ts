import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiTransportError,
  createRequestFingerprint,
  executeJsonApiRequest,
  parsePublicApiError,
  retryAfterSeconds,
  type PublicApiErrorContract,
} from "./core";
import { TRANSIENT_READ_RETRY_DELAY_MS } from "./transient-read-retry";

const ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "api_error",
  knownCodes: new Set(["account_setup_required", "validation_error"]),
  parseIssues: (value) => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((issue) =>
      typeof issue === "object" &&
      issue !== null &&
      "location" in issue &&
      issue.location === "title"
        ? [
            {
              location: ["body", "title"],
              message: "Review the title.",
              type: "validation_error",
            },
          ]
        : [],
    );
  },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("shared API transport core", () => {
  it("accepts additive public envelopes but keeps only allowlisted data", () => {
    expect(
      parsePublicApiError(
        {
          trace: "ignored",
          error: {
            code: "validation_error",
            message: "Private backend wording",
            issues: [
              { location: "title", message: "Private issue", type: "private" },
              { location: "secret", message: "Operator detail", type: "private" },
            ],
            future_field: true,
          },
        },
        ERROR_CONTRACT,
      ),
    ).toEqual({
      code: "validation_error",
      issues: [
        {
          location: ["body", "title"],
          message: "Review the title.",
          type: "validation_error",
        },
      ],
    });

    expect(
      parsePublicApiError(
        {
          error: {
            code: "internal_operator_failure",
            message: "Canonical UUID 99999999-9999-4999-8999-999999999999",
            issues: [{ location: "title" }],
          },
        },
        ERROR_CONTRACT,
      ),
    ).toEqual({ code: "api_error", issues: [] });
  });

  it("creates the same canonical request fingerprint as the backend", async () => {
    await expect(
      createRequestFingerprint({
        payload: { reason: "spam", details: null },
        recipe_version_id: "11111111-1111-4111-8111-111111111111",
        schema: "recipe-lab.recipe-report-request",
        version: 1,
      }),
    ).resolves.toBe(
      "aaaefe1638d140137083178803ea1d71ce663f5f9c58c291e43107c9b59c4b7e",
    );
  });

  it("parses Retry-After only as a safe non-negative integer", () => {
    expect(retryAfterSeconds(new Headers({ "Retry-After": "0" }))).toBe(0);
    expect(retryAfterSeconds(new Headers({ "Retry-After": "12" }))).toBe(12);
    expect(retryAfterSeconds(new Headers({ "Retry-After": "-1" }))).toBeNull();
    expect(retryAfterSeconds(new Headers({ "Retry-After": "1.5" }))).toBeNull();
    expect(
      retryAfterSeconds(
        new Headers({ "Retry-After": "999999999999999999999999" }),
      ),
    ).toBeNull();
  });

  it("does not dispatch a request whose caller signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const error = await executeJsonApiRequest(
      "/api/example",
      { method: "POST" },
      {
        errorContract: ERROR_CONTRACT,
        kind: "mutation",
        signal: controller.signal,
        timeoutMs: 1_000,
      },
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiTransportError);
    expect(error).toMatchObject({
      code: "request_aborted",
      outcome: "rejected",
      reason: "not_sent",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("times out one dispatched mutation without retrying it", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_target, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = executeJsonApiRequest(
      "/api/example",
      { method: "POST" },
      {
        errorContract: ERROR_CONTRACT,
        kind: "mutation",
        timeoutMs: 50,
      },
    );
    const expectation = expect(request).rejects.toMatchObject({
      code: "request_timed_out",
      outcome: "unknown",
      reason: "timeout",
      status: 0,
    });
    await vi.advanceTimersByTimeAsync(50);

    await expectation;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a transient query once and returns the recovered response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: { code: "temporary_failure" } }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ items: ["recipe"] }));
    vi.stubGlobal("fetch", fetchMock);

    const request = executeJsonApiRequest(
      "/api/example",
      { method: "GET" },
      {
        errorContract: ERROR_CONTRACT,
        kind: "query",
        timeoutMs: 1_000,
      },
    );
    await vi.advanceTimersByTimeAsync(TRANSIENT_READ_RETRY_DELAY_MS);

    await expect(request).resolves.toMatchObject({
      data: { items: ["recipe"] },
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after one retry when a transient query remains unavailable", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { code: "temporary_failure" } }, { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = executeJsonApiRequest(
      "/api/example",
      { method: "GET" },
      {
        errorContract: ERROR_CONTRACT,
        kind: "query",
        timeoutMs: 1_000,
      },
    );
    const expectation = expect(request).rejects.toMatchObject({
      reason: "http",
      status: 503,
    });
    await vi.advanceTimersByTimeAsync(TRANSIENT_READ_RETRY_DELAY_MS);

    await expectation;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats a caller abort after dispatch as an unknown mutation result", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_target, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = executeJsonApiRequest(
      "/api/example",
      { method: "POST" },
      {
        errorContract: ERROR_CONTRACT,
        kind: "mutation",
        signal: controller.signal,
        timeoutMs: 1_000,
      },
    );
    const expectation = expect(request).rejects.toMatchObject({
      code: "request_aborted",
      outcome: "unknown",
      reason: "aborted",
      status: 0,
    });
    controller.abort();

    await expectation;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    { expectedOutcome: "rejected", status: 422 },
    { expectedOutcome: "unknown", status: 408 },
    { expectedOutcome: "unknown", status: 502 },
    { expectedOutcome: "unknown", status: 503 },
  ])(
    "classifies HTTP $status mutation outcomes without retrying",
    async ({ expectedOutcome, status }) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "internal_operator_failure",
              message: "Private service detail",
              issues: [{ location: "secret" }],
              additive: true,
            },
            correlation_id: "private-correlation",
          },
          { status },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const error = await executeJsonApiRequest(
        "/api/example",
        { method: "POST" },
        {
          errorContract: ERROR_CONTRACT,
          kind: "mutation",
          timeoutMs: 1_000,
        },
      ).catch((reason: unknown) => reason);

      expect(error).toMatchObject({
        code: "api_error",
        issues: [],
        outcome: expectedOutcome,
        reason: "http",
        status,
      });
      expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
        /operator|private|correlation|secret/i,
      );
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("treats an unreadable success body as an ambiguous mutation result", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not-json", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      executeJsonApiRequest(
        "/api/example",
        { method: "POST" },
        {
          errorContract: ERROR_CONTRACT,
          kind: "mutation",
          timeoutMs: 1_000,
        },
      ),
    ).rejects.toMatchObject({
      code: "invalid_api_response",
      outcome: "unknown",
      reason: "invalid_response",
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
