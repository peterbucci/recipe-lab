import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  browseRecipeDrafts,
  createRecipeDraft,
  discardRecipeDraft,
  findActiveRecipeDraftForSource,
  parseRecipeDraftDetail,
  parseRecipeDraftPage,
  recipeDraftCreationRequestFingerprint,
  RecipeDraftApiError,
  updateRecipeDraft,
} from "./recipe-draft-api";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "33333333-3333-4333-8333-333333333333";
const CATEGORY_ID = "44444444-4444-4444-8444-444444444444";

const blankDetail = {
  id: DRAFT_ID,
  source_version_id: null,
  status: "active",
  revision: 1,
  title: "",
  description: null,
  servings: null,
  total_time_minutes: null,
  active_time_minutes: null,
  difficulty: null,
  notes: null,
  categories: [
    { id: CATEGORY_ID, name: "Quick & easy", slug: "quick-easy" },
  ],
  ingredients: [],
  instructions: [],
  created_at: "2026-08-25T12:00:00Z",
  updated_at: "2026-08-25T12:00:00Z",
};

const sourcedSummary = {
  id: DRAFT_ID,
  source_version_id: SOURCE_ID,
  status: "active",
  revision: 3,
  title: "Private version",
  ingredient_count: 4,
  instruction_count: 2,
  created_at: "2026-08-25T12:00:00Z",
  updated_at: "2026-08-25T13:00:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "recipe_lab_csrf=; Max-Age=0; path=/";
});

describe("private recipe draft API", () => {
  it("accepts the server's intentionally incomplete blank draft", () => {
    expect(parseRecipeDraftDetail(blankDetail)).toMatchObject({
      id: DRAFT_ID,
      revision: 1,
      title: "",
      categories: [
        { id: CATEGORY_ID, name: "Quick & easy", slug: "quick-easy" },
      ],
      ingredients: [],
    });
  });

  it("accepts validated cooking metadata and notes", () => {
    expect(
      parseRecipeDraftDetail({
        ...blankDetail,
        total_time_minutes: 75,
        active_time_minutes: 30,
        difficulty: "medium",
        notes: "Let the dough rest before shaping.",
      }),
    ).toMatchObject({
      total_time_minutes: 75,
      active_time_minutes: 30,
      difficulty: "medium",
      notes: "Let the dough rest before shaping.",
    });
  });

  it("rejects unordered or malformed private responses", () => {
    expect(() => parseRecipeDraftDetail({ ...blankDetail, revision: 0 })).toThrow(RecipeDraftApiError);
    expect(() =>
      parseRecipeDraftDetail({
        ...blankDetail,
        categories: [blankDetail.categories[0], blankDetail.categories[0]],
      }),
    ).toThrow(RecipeDraftApiError);
    expect(() =>
      parseRecipeDraftDetail({
        ...blankDetail,
        total_time_minutes: 30,
        active_time_minutes: 45,
      }),
    ).toThrow(RecipeDraftApiError);
    expect(() =>
      parseRecipeDraftDetail({ ...blankDetail, difficulty: "expert" }),
    ).toThrow(RecipeDraftApiError);
    expect(() =>
      parseRecipeDraftDetail({ ...blankDetail, notes: "" }),
    ).toThrow(RecipeDraftApiError);
    expect(() => parseRecipeDraftPage({
      items: [{
        id: DRAFT_ID,
        source_version_id: null,
        status: "active",
        revision: 1,
        title: "Recipe",
        ingredient_count: -1,
        instruction_count: 0,
        created_at: blankDetail.created_at,
        updated_at: blankDetail.updated_at,
      }],
      page: 1,
      page_size: 20,
      total: 1,
      total_pages: 1,
    })).toThrow(RecipeDraftApiError);
  });

  it("looks up the most recent active draft for one exact source", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [sourcedSummary],
        page: 1,
        page_size: 1,
        total: 1,
        total_pages: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findActiveRecipeDraftForSource(SOURCE_ID.toUpperCase()),
    ).resolves.toEqual(sourcedSummary);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipe-drafts?page=1&page_size=1&source_version_id=${SOURCE_ID}`,
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
  });

  it("returns null when a source has no active draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [],
          page: 1,
          page_size: 1,
          total: 0,
          total_pages: 0,
        }),
      ),
    );

    await expect(
      findActiveRecipeDraftForSource(SOURCE_ID),
    ).resolves.toBeNull();
  });

  it("rejects an invalid source identifier without dispatching", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findActiveRecipeDraftForSource("not-a-recipe-id"),
    ).rejects.toMatchObject({
      code: "invalid_identifier",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not resume a draft returned for a different source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [{ ...sourcedSummary, source_version_id: CATEGORY_ID }],
          page: 1,
          page_size: 1,
          total: 1,
          total_pages: 1,
        }),
      ),
    );

    await expect(
      findActiveRecipeDraftForSource(SOURCE_ID),
    ).rejects.toMatchObject({
      code: "invalid_recipe_draft_response",
      status: 502,
    });
  });

  it("preserves the unfiltered draft browse request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [],
        page: 2,
        page_size: 10,
        total: 0,
        total_pages: 0,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await browseRecipeDrafts({ page: 2, pageSize: 10 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recipe-drafts?page=2&page_size=10",
      expect.any(Object),
    );
  });

  it("creates an original draft through the shared mutation transport", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(blankDetail, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createRecipeDraft(null, ACTION_ID)).resolves.toMatchObject({ id: DRAFT_ID });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(target).toBe("/api/recipe-drafts");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      body: JSON.stringify({ source_version_id: null }),
    });
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe(ACTION_ID);
    expect(headers.get("X-CSRF-Token")).toBe("test-token");
  });

  it("keeps blank and source fingerprints distinct while canonicalizing UUID casing", async () => {
    const blank = await recipeDraftCreationRequestFingerprint(null);
    const source = await recipeDraftCreationRequestFingerprint(SOURCE_ID);
    const uppercaseSource = await recipeDraftCreationRequestFingerprint(
      SOURCE_ID.toUpperCase(),
    );

    expect(blank).toMatch(/^[0-9a-f]{64}$/);
    expect(source).toMatch(/^[0-9a-f]{64}$/);
    expect(source).not.toBe(blank);
    expect(uppercaseSource).toBe(source);
  });

  it("sends the canonical source payload with the caller's persisted action key", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { ...blankDetail, source_version_id: SOURCE_ID },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createRecipeDraft(SOURCE_ID.toUpperCase(), ACTION_ID);

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({ source_version_id: SOURCE_ID }));
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(ACTION_ID);
  });

  it("exposes a lost response as unknown and recovers with the same action key", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("private network detail"))
      .mockResolvedValueOnce(Response.json(blankDetail, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const lost = await createRecipeDraft(null, ACTION_ID).catch(
      (reason: unknown) => reason,
    );
    expect(lost).toBeInstanceOf(RecipeDraftApiError);
    expect(lost).toMatchObject({
      code: "network_error",
      outcome: "unknown",
      status: 0,
    });
    await expect(createRecipeDraft(null, ACTION_ID)).resolves.toMatchObject({
      id: DRAFT_ID,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get("Idempotency-Key"),
      ),
    ).toEqual([ACTION_ID, ACTION_ID]);
  });

  it("treats a malformed success as ambiguous and does not retry automatically", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ ...blankDetail, id: "private-server-junk" }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createRecipeDraft(null, ACTION_ID)).rejects.toMatchObject({
      code: "invalid_recipe_draft_response",
      outcome: "unknown",
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not accept a valid-looking draft from a different creation intent", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { ...blankDetail, source_version_id: SOURCE_ID },
          { status: 201 },
        ),
      ),
    );

    await expect(createRecipeDraft(null, ACTION_ID)).rejects.toMatchObject({
      code: "invalid_recipe_draft_response",
      outcome: "unknown",
    });
  });

  it("rejects an invalid action key before dispatch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createRecipeDraft(null, "not-a-uuid")).rejects.toMatchObject({
      code: "invalid_idempotency_key",
      outcome: "rejected",
      status: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("announces an expired session while retaining the typed API error", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "authentication_required",
              message: "Private provider detail",
              issues: [],
            },
          },
          { status: 401 },
        ),
      ),
    );

    await expect(
      updateRecipeDraft(
        DRAFT_ID,
        {
          revision: 1,
          title: "Unsaved title",
          description: null,
          servings: null,
          total_time_minutes: null,
          active_time_minutes: null,
          difficulty: null,
          notes: null,
          category_ids: [],
          ingredients: [],
          instructions: [],
        },
        "save-key",
      ),
    ).rejects.toMatchObject({
      code: "authentication_required",
      status: 401,
      message: "Your session expired. Your private draft is still here; sign in again to continue.",
    });
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it("keeps save and discard failures free of backend messages and identifiers", async () => {
    document.cookie = "recipe_lab_csrf=test-token; path=/";
    const internalId = "99999999-9999-4999-8999-999999999999";
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "invalid_recipe_draft",
                message: `Canonical ingredient occurrence ${internalId} failed validation.`,
                issues: [
                  {
                    location: ["body", "category_ids", 0],
                    message: `Category UUID ${internalId} is not active.`,
                    type: "internal_catalog_policy_failure",
                  },
                  {
                    location: ["body", "ingredients", 0, "selection", "ingredient_id"],
                    message: `Ingredient UUID ${internalId} is not canonical.`,
                    type: "internal_catalog_policy_failure",
                  },
                  {
                    location: ["body", internalId],
                    message: "Private operator detail",
                    type: "internal_error",
                  },
                ],
              },
            },
            { status: 422 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "recipe_draft_not_found",
                message: `Recipe draft ${internalId} was not found.`,
                issues: [],
              },
            },
            { status: 404 },
          ),
        ),
    );

    const saveError = await updateRecipeDraft(
      DRAFT_ID,
      {
        revision: 1,
        title: "Unsaved title",
        description: null,
        servings: null,
        total_time_minutes: null,
        active_time_minutes: null,
        difficulty: null,
        notes: null,
        category_ids: [],
        ingredients: [],
        instructions: [],
      },
      "save-key",
    ).catch((reason: unknown) => reason);
    expect(saveError).toMatchObject({
      status: 422,
      code: "invalid_recipe_draft",
      message: "Some draft fields need attention. Review them and try again.",
      issues: [
        {
          location: ["body", "category_ids", 0],
          message: "Review the recipe categories.",
          type: "validation_error",
        },
        {
          location: ["body", "ingredients", 0, "selection", "ingredient_id"],
          message: "Review this ingredient.",
          type: "validation_error",
        },
      ],
    });
    expect(`${String(saveError)} ${JSON.stringify(saveError)}`).not.toContain(internalId);
    expect(`${String(saveError)} ${JSON.stringify(saveError)}`).not.toMatch(
      /canonical|occurrence|operator|policy/i,
    );

    const discardError = await discardRecipeDraft(DRAFT_ID, 1, "discard-key").catch(
      (reason: unknown) => reason,
    );
    expect(discardError).toMatchObject({
      status: 404,
      code: "recipe_draft_not_found",
      message: "This private draft is no longer available.",
    });
    expect(`${String(discardError)} ${JSON.stringify(discardError)}`).not.toContain(internalId);
  });
});
