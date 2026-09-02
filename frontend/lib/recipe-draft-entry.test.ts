import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecipeDraftApiError } from "./recipe-draft-api";
import {
  recipeDraftEntryErrorMessage,
  startOrResumeRecipeDraft,
  startOrResumeRecipeDraftDetail,
} from "./recipe-draft-entry";

const mocks = vi.hoisted(() => ({
  clearRecipeDraftCreationAttempt: vi.fn(),
  createRecipeDraft: vi.fn(),
  fetchRecipeDraft: vi.fn(),
  findActiveRecipeDraftForSource: vi.fn(),
  getOrCreateRecipeDraftCreationAttempt: vi.fn(),
}));

vi.mock("./recipe-draft-creation-attempt", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./recipe-draft-creation-attempt")>();
  return {
    ...actual,
    clearRecipeDraftCreationAttempt: mocks.clearRecipeDraftCreationAttempt,
    getOrCreateRecipeDraftCreationAttempt:
      mocks.getOrCreateRecipeDraftCreationAttempt,
  };
});

vi.mock("./recipe-draft-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recipe-draft-api")>();
  return {
    ...actual,
    createRecipeDraft: mocks.createRecipeDraft,
    fetchRecipeDraft: mocks.fetchRecipeDraft,
    findActiveRecipeDraftForSource: mocks.findActiveRecipeDraftForSource,
  };
});

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const ACTIVE_DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const CREATED_DRAFT_ID = "33333333-3333-4333-8333-333333333333";
const FIRST_KEY = "44444444-4444-4444-8444-444444444444";
const SECOND_KEY = "55555555-5555-4555-8555-555555555555";

function attempt(idempotencyKey: string) {
  return {
    actor_id: "member-one",
    idempotency_key: idempotencyKey,
    intent: `source:${SOURCE_ID}`,
    version: 1 as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findActiveRecipeDraftForSource.mockResolvedValue(null);
  mocks.getOrCreateRecipeDraftCreationAttempt.mockReturnValue(
    attempt(FIRST_KEY),
  );
});

describe("recipe draft entry", () => {
  it("opens an existing active version without creating another draft", async () => {
    mocks.findActiveRecipeDraftForSource.mockResolvedValue({
      id: ACTIVE_DRAFT_ID,
    });

    await expect(
      startOrResumeRecipeDraft("member-one", SOURCE_ID),
    ).resolves.toBe(ACTIVE_DRAFT_ID);

    expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledWith(
      SOURCE_ID,
    );
    expect(mocks.createRecipeDraft).not.toHaveBeenCalled();
    expect(mocks.getOrCreateRecipeDraftCreationAttempt).not.toHaveBeenCalled();
  });

  it("fetches and returns the full detail for an existing active draft", async () => {
    const detail = {
      id: ACTIVE_DRAFT_ID,
      source_version_id: SOURCE_ID,
      status: "active" as const,
      revision: 3,
      title: "My tomato soup",
      description: null,
      servings: "4",
      total_time_minutes: 30,
      active_time_minutes: 15,
      difficulty: "easy" as const,
      notes: null,
      categories: [],
      ingredients: [],
      instructions: [],
      created_at: "2026-08-30T12:00:00Z",
      updated_at: "2026-08-30T13:00:00Z",
    };
    mocks.findActiveRecipeDraftForSource.mockResolvedValue({
      id: ACTIVE_DRAFT_ID,
    });
    mocks.fetchRecipeDraft.mockResolvedValue(detail);

    await expect(
      startOrResumeRecipeDraftDetail("member-one", SOURCE_ID),
    ).resolves.toBe(detail);

    expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledWith(
      SOURCE_ID,
    );
    expect(mocks.fetchRecipeDraft).toHaveBeenCalledWith(ACTIVE_DRAFT_ID);
    expect(mocks.createRecipeDraft).not.toHaveBeenCalled();
    expect(mocks.getOrCreateRecipeDraftCreationAttempt).not.toHaveBeenCalled();
  });

  it("creates one recoverable draft and clears its attempt after receiving a valid id", async () => {
    mocks.createRecipeDraft.mockResolvedValue({ id: CREATED_DRAFT_ID });

    await expect(
      startOrResumeRecipeDraft("member-one", SOURCE_ID),
    ).resolves.toBe(CREATED_DRAFT_ID);

    expect(mocks.createRecipeDraft).toHaveBeenCalledWith(SOURCE_ID, FIRST_KEY);
    expect(mocks.clearRecipeDraftCreationAttempt).toHaveBeenCalledWith(
      attempt(FIRST_KEY),
      SOURCE_ID,
    );
  });

  it("retires one terminally conflicting key and makes one bounded retry", async () => {
    mocks.getOrCreateRecipeDraftCreationAttempt
      .mockReturnValueOnce(attempt(FIRST_KEY))
      .mockReturnValueOnce(attempt(SECOND_KEY));
    mocks.createRecipeDraft
      .mockRejectedValueOnce(
        new RecipeDraftApiError(
          "That completed action cannot be reused.",
          409,
          "idempotency_key_conflict",
        ),
      )
      .mockResolvedValueOnce({ id: CREATED_DRAFT_ID });

    await expect(
      startOrResumeRecipeDraft("member-one", SOURCE_ID),
    ).resolves.toBe(CREATED_DRAFT_ID);

    expect(mocks.createRecipeDraft).toHaveBeenNthCalledWith(
      1,
      SOURCE_ID,
      FIRST_KEY,
    );
    expect(mocks.createRecipeDraft).toHaveBeenNthCalledWith(
      2,
      SOURCE_ID,
      SECOND_KEY,
    );
    expect(mocks.clearRecipeDraftCreationAttempt).toHaveBeenNthCalledWith(
      1,
      attempt(FIRST_KEY),
      SOURCE_ID,
    );
    expect(mocks.clearRecipeDraftCreationAttempt).toHaveBeenNthCalledWith(
      2,
      attempt(SECOND_KEY),
      SOURCE_ID,
    );
  });

  it("does not expose unknown error details in entry copy", () => {
    expect(
      recipeDraftEntryErrorMessage(new Error("private upstream detail")),
    ).toBe(
      "Recipe Lab could not start this private draft. Try again to recover the same draft.",
    );
  });
});
