// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page, Response } from "@playwright/test";

import type { SourceDraftScope } from "../e2e/acceptance-draft-isolation";
import type { MemberName } from "../e2e/acceptance-session";

const mocks = vi.hoisted(() => ({ extend: vi.fn(), member: vi.fn() }));
vi.mock("@playwright/test", () => ({ test: { extend: mocks.extend }, expect: {} }));
vi.mock("../e2e/acceptance-session", () => ({ useAcceptanceMember: mocks.member }));
import "../e2e/acceptance-draft-isolation";

const SOURCE = "11111111-1111-4111-8111-111111111111";
const OTHER_SOURCE = "22222222-2222-4222-8222-222222222222";
const DRAFT = "33333333-3333-4333-8333-333333333333";
const OTHER_DRAFT = "44444444-4444-4444-8444-444444444444";
const ALICE = "55555555-5555-4555-8555-555555555555";
const BOB = "66666666-6666-4666-8666-666666666666";
const BASE = "http://127.0.0.1:43123";
const PRIVATE_CANARY = "private-response-and-cookie-canary";
const fixture = mocks.extend.mock.calls[0][0].sourceDrafts as (
  args: { page: Page },
  use: (scope: SourceDraftScope) => Promise<void>,
) => Promise<void>;

function member(name: MemberName) {
  return {
    user_id: name === "alice" ? ALICE : BOB,
    session_token: `${name}-session-private`,
    csrf_token: `${name}-csrf-private`,
  };
}

function apiResponse(status: number, payload: unknown = null) {
  return { status: () => status, json: vi.fn(async () => payload) };
}

function draft(overrides: Record<string, unknown> = {}) {
  return { id: DRAFT, source_version_id: SOURCE, status: "active", revision: 4, ...overrides };
}

function emptyPage(overrides: Record<string, unknown> = {}) {
  return { items: [], total: 0, page: 1, page_size: 1, total_pages: 0, ...overrides };
}

function harness() {
  const listeners = new Set<(response: Response) => void>();
  const get = vi.fn().mockResolvedValue(apiResponse(200, emptyPage()));
  const discard = vi.fn().mockResolvedValue(apiResponse(204));
  const page = {
    request: { get, delete: discard },
    on: vi.fn((_event: string, listener: (response: Response) => void) => listeners.add(listener)),
    off: vi.fn((_event: string, listener: (response: Response) => void) => listeners.delete(listener)),
  };
  return {
    page,
    get,
    discard,
    emit: (response: Response) => listeners.forEach((listener) => listener(response)),
    run: (use: (scope: SourceDraftScope) => Promise<void>) => fixture({ page: page as unknown as Page }, use),
  };
}

function createdResponse({
  source = SOURCE,
  cookie = "recipe_lab_session=alice-session-private; recipe_lab_csrf=alice-csrf-private",
  payload = draft(),
  json,
  status = 201,
  url = `${BASE}/api/recipe-drafts`,
}: {
  source?: string | null;
  cookie?: string;
  payload?: unknown;
  json?: () => Promise<unknown>;
  status?: number;
  url?: string;
} = {}): Response {
  return {
    status: () => status,
    json: json ?? (async () => payload),
    request: () => ({
      url: () => url,
      method: () => "POST",
      postDataJSON: () => ({ source_version_id: source }),
      // The synchronous headers deliberately omit cookies, like Playwright.
      headers: () => ({}),
      allHeaders: async () => ({ cookie }),
    }),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubEnv("PLAYWRIGHT_BASE_URL", BASE);
  mocks.member.mockReset().mockImplementation(async (_page, name: MemberName) => member(name));
});

describe("source draft acceptance isolation", () => {
  it("checks only the exact source and rejects pre-existing drafts without deleting them", async () => {
    const h = harness();
    h.get.mockResolvedValue(apiResponse(200, emptyPage({ items: [draft()], total: 1, total_pages: 1 })));
    await expect(h.run((scope) => scope.assertFresh("alice", SOURCE)))
      .rejects.toThrow("pre-existing active member/source draft found");
    const url = new URL(h.get.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe(`${BASE}/api/recipe-drafts`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ source_version_id: SOURCE, page: "1", page_size: "1" });
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.discard).not.toHaveBeenCalled();
  });

  it("requires successful freshness before explicit tracking", async () => {
    const h = harness();
    await expect(h.run(async (scope) => scope.trackExplicit("alice", SOURCE, DRAFT)))
      .rejects.toThrow("requires a successful freshness check");
    expect(h.get).not.toHaveBeenCalled();
    expect(h.discard).not.toHaveBeenCalled();
  });

  it("deletes only a tracked owned draft using its current revision and member CSRF", async () => {
    const h = harness();
    h.get.mockResolvedValueOnce(apiResponse(200, emptyPage()))
      .mockResolvedValueOnce(apiResponse(200, draft({ revision: 19 })));
    await h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      scope.trackExplicit("alice", SOURCE, DRAFT);
      scope.trackExplicit("alice", SOURCE, DRAFT);
    });
    expect(h.get).toHaveBeenCalledTimes(2);
    expect(h.get.mock.calls[1][0]).toBe(`${BASE}/api/recipe-drafts/${DRAFT}`);
    expect(mocks.member.mock.calls.map((call) => call[1])).toEqual(["alice", "alice"]);
    expect(h.discard).toHaveBeenCalledTimes(1);
    expect(h.discard).toHaveBeenCalledWith(`${BASE}/api/recipe-drafts/${DRAFT}?revision=19`, {
      headers: {
        Accept: "application/json", Origin: BASE,
        "X-CSRF-Token": "alice-csrf-private",
        "Idempotency-Key": expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    });
    expect(h.page.off).toHaveBeenCalledWith("response", expect.any(Function));
  });

  it("drains an asynchronous POST 201 capture and cleans up even when the journey fails", async () => {
    const h = harness();
    h.get.mockResolvedValueOnce(apiResponse(200, emptyPage()))
      .mockResolvedValueOnce(apiResponse(200, draft()));
    let resolvePayload!: (value: unknown) => void;
    const payload = new Promise<unknown>((resolve) => { resolvePayload = resolve; });
    const run = h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      h.emit(createdResponse({ json: () => payload }));
      queueMicrotask(() => resolvePayload(draft()));
      throw new Error("journey failed");
    });
    await expect(run).rejects.toThrow("journey failed");
    expect(h.discard).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated sources, blank drafts, other origins and non-created responses", async () => {
    const h = harness();
    await h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      h.emit(createdResponse({ source: OTHER_SOURCE }));
      h.emit(createdResponse({ source: null }));
      h.emit(createdResponse({ url: "http://127.0.0.1:43124/api/recipe-drafts" }));
      h.emit(createdResponse({ status: 409 }));
    });
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.discard).not.toHaveBeenCalled();
  });

  it.each(["", "recipe_lab_session=bob-session-private", "recipe_lab_session=alice-session-private; recipe_lab_session=bob-session-private"])(
    "refuses creation capture with an absent, foreign, or ambiguous member cookie (%#)", async (cookie) => {
      const h = harness();
      await expect(h.run(async (scope) => {
        await scope.assertFresh("alice", SOURCE);
        h.emit(createdResponse({ cookie }));
      })).rejects.toThrow("created draft response could not be safely tracked");
      expect(h.discard).not.toHaveBeenCalled();
    },
  );

  it("refuses cleanup when the registered member identity changes", async () => {
    const h = harness();
    mocks.member.mockResolvedValueOnce(member("alice")).mockResolvedValueOnce(member("bob"));
    await expect(h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      scope.trackExplicit("alice", SOURCE, DRAFT);
    })).rejects.toThrow("tracked draft cleanup could not be safely completed");
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.discard).not.toHaveBeenCalled();
  });

  it.each([
    { id: OTHER_DRAFT }, { source_version_id: OTHER_SOURCE }, { status: "published" },
    { status: "discarded" }, { revision: 0 }, { revision: 1.5 },
  ])("refuses mismatched identity/source or non-contract status/revision (%#)", async (overrides) => {
    const h = harness();
    h.get.mockResolvedValueOnce(apiResponse(200, emptyPage()))
      .mockResolvedValueOnce(apiResponse(200, draft(overrides)));
    await expect(h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      scope.trackExplicit("alice", SOURCE, DRAFT);
    })).rejects.toThrow("tracked draft cleanup could not be safely completed");
    expect(h.discard).not.toHaveBeenCalled();
  });

  it("accepts the exact owner-scoped not-found contract for terminal drafts without deletion", async () => {
    const h = harness();
    h.get.mockResolvedValueOnce(apiResponse(200, emptyPage()))
      .mockResolvedValueOnce(apiResponse(404, { error: { code: "recipe_draft_not_found" } }));
    await h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      scope.trackExplicit("alice", SOURCE, DRAFT);
    });
    expect(h.discard).not.toHaveBeenCalled();
  });

  it.each([401, 403, 409, 500, 404])("rejects lookup status %i without the strict terminal contract", async (status) => {
    const h = harness();
    h.get.mockResolvedValueOnce(apiResponse(200, emptyPage()))
      .mockResolvedValueOnce(apiResponse(status, { error: { code: PRIVATE_CANARY } }));
    await expect(h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      scope.trackExplicit("alice", SOURCE, DRAFT);
    })).rejects.toThrow(/^Source draft isolation failed: tracked draft cleanup could not be safely completed\.$/);
    expect(h.discard).not.toHaveBeenCalled();
  });

  it.each([401, 403, 409, 500, 404])("fails cleanup on discard status %i without the strict terminal contract", async (status) => {
    const h = harness();
    h.get.mockResolvedValueOnce(apiResponse(200, emptyPage()))
      .mockResolvedValueOnce(apiResponse(200, draft()));
    h.discard.mockResolvedValue(apiResponse(status, { error: { code: PRIVATE_CANARY } }));
    await expect(h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      scope.trackExplicit("alice", SOURCE, DRAFT);
    })).rejects.toThrow(/^Source draft isolation failed: tracked draft cleanup could not be safely completed\.$/);
  });

  it("accepts strict terminal not-found if a tracked draft is discarded after its lookup", async () => {
    const h = harness();
    h.get.mockResolvedValueOnce(apiResponse(200, emptyPage()))
      .mockResolvedValueOnce(apiResponse(200, draft()));
    h.discard.mockResolvedValue(apiResponse(404, { error: { code: "recipe_draft_not_found" } }));
    await h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      scope.trackExplicit("alice", SOURCE, DRAFT);
    });
    expect(h.discard).toHaveBeenCalledTimes(1);
  });

  it("continues safely scoped cleanup after another tracked draft fails", async () => {
    const h = harness();
    h.get.mockResolvedValueOnce(apiResponse(200, emptyPage()))
      .mockResolvedValueOnce(apiResponse(500))
      .mockResolvedValueOnce(apiResponse(200, draft({ id: OTHER_DRAFT })));
    await expect(h.run(async (scope) => {
      await scope.assertFresh("alice", SOURCE);
      scope.trackExplicit("alice", SOURCE, DRAFT);
      scope.trackExplicit("alice", SOURCE, OTHER_DRAFT);
    })).rejects.toThrow("tracked draft cleanup could not be safely completed");
    expect(h.discard).toHaveBeenCalledTimes(1);
    expect(h.discard.mock.calls[0][0]).toBe(`${BASE}/api/recipe-drafts/${OTHER_DRAFT}?revision=4`);
  });

  it("does not expose private transport errors during freshness checks", async () => {
    const h = harness();
    h.get.mockRejectedValue(new Error(PRIVATE_CANARY));
    await expect(h.run((scope) => scope.assertFresh("alice", SOURCE)))
      .rejects.toThrow(/^Source draft isolation failed: freshness check unavailable\.$/);
    expect(h.discard).not.toHaveBeenCalled();
  });

  it.each([emptyPage({ total_pages: 1 }), emptyPage({ page_size: 20 }), { items: [] }])(
    "rejects malformed freshness responses without registering cleanup (%#)", async (payload) => {
      const h = harness();
      h.get.mockResolvedValue(apiResponse(200, payload));
      await expect(h.run((scope) => scope.assertFresh("alice", SOURCE))).rejects.toThrow("freshness response");
      expect(h.discard).not.toHaveBeenCalled();
    },
  );
});
