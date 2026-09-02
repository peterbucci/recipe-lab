import { describe, expect, it } from "vitest";

import type { RecipeDraftDetail } from "./recipe-draft-api";
import {
  initialRecipeDraftEditorDomainState,
  prepareDraftDiscardAttempt,
  prepareDraftSaveAttempt,
  recipeDraftEditorIsDirty,
  recipeDraftEditorReducer,
  type DraftFailureKind,
  type RecipeDraftEditorDomainState,
} from "./recipe-draft-editor-state";
import {
  recipeDraftFingerprint,
  type RecipeDraftEditorState,
} from "./recipe-draft";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const SAVE_KEY = "22222222-2222-4222-8222-222222222222";
const NEXT_SAVE_KEY = "33333333-3333-4333-8333-333333333333";
const DISCARD_KEY = "44444444-4444-4444-8444-444444444444";
const NEXT_DISCARD_KEY = "55555555-5555-4555-8555-555555555555";
const CATEGORY = {
  id: "66666666-6666-4666-8666-666666666666",
  name: "Dinner",
  slug: "dinner",
};

const detail: RecipeDraftDetail = {
  id: DRAFT_ID,
  source_version_id: null,
  status: "active",
  revision: 3,
  title: "Saved soup",
  description: null,
  servings: null,
  total_time_minutes: null,
  active_time_minutes: null,
  difficulty: null,
  notes: null,
  categories: [],
  ingredients: [],
  instructions: [],
  created_at: "2026-08-25T12:00:00Z",
  updated_at: "2026-08-25T12:00:00Z",
};

const savedDraft: RecipeDraftEditorState = {
  title: "Saved soup",
  description: "",
  servings: "",
  totalTimeMinutes: "",
  activeTimeMinutes: "",
  difficulty: "",
  notes: "",
  categories: [],
  ingredients: [],
  instructions: [],
};

function load(
  draft: RecipeDraftEditorState = savedDraft,
  loadedDetail: RecipeDraftDetail = detail,
): RecipeDraftEditorDomainState {
  return recipeDraftEditorReducer(initialRecipeDraftEditorDomainState, {
    detail: loadedDetail,
    draft,
    mode: "initial",
    type: "draft-loaded",
  });
}

function change(
  state: RecipeDraftEditorDomainState,
  title: string,
): RecipeDraftEditorDomainState {
  return recipeDraftEditorReducer(state, {
    draft: { ...savedDraft, title },
    type: "draft-changed",
  });
}

describe("recipe draft editor domain state", () => {
  it("moves a saved draft through clean, dirty, saving, and saved states", () => {
    const clean = load();
    expect(clean.work.status).toBe("clean");
    expect(clean.save).toEqual({ attempt: null, status: "idle" });
    expect(recipeDraftEditorIsDirty(clean)).toBe(false);

    const editedDraft = { ...savedDraft, title: "Edited soup" };
    const dirty = recipeDraftEditorReducer(clean, {
      draft: editedDraft,
      type: "draft-changed",
    });
    expect(dirty.work.status).toBe("dirty");
    expect(recipeDraftEditorIsDirty(dirty)).toBe(true);

    const attempt = prepareDraftSaveAttempt(dirty, {
      fingerprint: recipeDraftFingerprint(editedDraft),
      newIdempotencyKey: SAVE_KEY,
      revision: detail.revision,
    });
    const saving = recipeDraftEditorReducer(dirty, {
      attempt,
      type: "save-started",
    });
    expect(saving.save).toEqual({ attempt, status: "saving" });

    const nextDetail = {
      ...detail,
      revision: 4,
      title: editedDraft.title,
      updated_at: "2026-08-25T12:01:00Z",
    };
    const saved = recipeDraftEditorReducer(saving, {
      attemptId: SAVE_KEY,
      detail: nextDetail,
      draft: editedDraft,
      type: "save-succeeded",
    });
    expect(saved.save).toEqual({ newerLocalWork: false, status: "saved" });
    expect(saved.work).toMatchObject({
      detail: nextDetail,
      draft: editedDraft,
      status: "clean",
    });
    expect(recipeDraftEditorIsDirty(saved)).toBe(false);
  });

  it("ignores a stale save completion and never replaces newer local work", () => {
    const submittedDraft = { ...savedDraft, title: "Submitted soup" };
    const dirty = recipeDraftEditorReducer(load(), {
      draft: submittedDraft,
      type: "draft-changed",
    });
    const attempt = prepareDraftSaveAttempt(dirty, {
      fingerprint: recipeDraftFingerprint(submittedDraft),
      newIdempotencyKey: SAVE_KEY,
      revision: detail.revision,
    });
    const saving = recipeDraftEditorReducer(dirty, {
      attempt,
      type: "save-started",
    });
    const newerDraft = {
      ...savedDraft,
      title: "Newer local soup",
      categories: [CATEGORY],
    };
    const savingWithNewerWork = recipeDraftEditorReducer(saving, {
      draft: newerDraft,
      type: "draft-changed",
    });

    const staleCompletion = recipeDraftEditorReducer(savingWithNewerWork, {
      attemptId: NEXT_SAVE_KEY,
      detail: { ...detail, revision: 4 },
      draft: submittedDraft,
      type: "save-succeeded",
    });
    expect(staleCompletion).toBe(savingWithNewerWork);

    const completed = recipeDraftEditorReducer(savingWithNewerWork, {
      attemptId: SAVE_KEY,
      detail: { ...detail, revision: 4, title: submittedDraft.title },
      draft: submittedDraft,
      type: "save-succeeded",
    });
    expect(completed.save).toEqual({ newerLocalWork: true, status: "saved" });
    expect(completed.work).toMatchObject({
      detail: { revision: 4 },
      draft: { categories: [CATEGORY], title: "Newer local soup" },
      status: "dirty",
    });
  });

  it.each([
    "authentication-interruption",
    "ambiguous-result",
    "failed-retryable",
    "revision-conflict",
  ] satisfies DraftFailureKind[])(
    "records a %s save failure without losing its retry attempt",
    (kind) => {
      const dirty = change(load(), "Retry soup");
      const fingerprint =
        dirty.work.status === "unavailable"
          ? ""
          : recipeDraftFingerprint(dirty.work.draft);
      const attempt = prepareDraftSaveAttempt(dirty, {
        fingerprint,
        newIdempotencyKey: SAVE_KEY,
        revision: detail.revision,
      });
      const saving = recipeDraftEditorReducer(dirty, {
        attempt,
        type: "save-started",
      });
      const failed = recipeDraftEditorReducer(saving, {
        attemptId: SAVE_KEY,
        kind,
        type: "save-failed",
      });

      expect(failed.save).toEqual({ attempt, status: kind });
      expect(
        prepareDraftSaveAttempt(failed, {
          fingerprint,
          newIdempotencyKey: NEXT_SAVE_KEY,
          revision: detail.revision,
        }),
      ).toBe(attempt);
    },
  );

  it("rotates a save attempt when its document fingerprint or revision changes", () => {
    const dirty = change(load(), "First attempt");
    const firstFingerprint =
      dirty.work.status === "unavailable"
        ? ""
        : recipeDraftFingerprint(dirty.work.draft);
    const first = prepareDraftSaveAttempt(dirty, {
      fingerprint: firstFingerprint,
      newIdempotencyKey: SAVE_KEY,
      revision: 3,
    });
    const failed = recipeDraftEditorReducer(
      recipeDraftEditorReducer(dirty, { attempt: first, type: "save-started" }),
      {
        attemptId: SAVE_KEY,
        kind: "failed-retryable",
        type: "save-failed",
      },
    );

    expect(
      prepareDraftSaveAttempt(failed, {
        fingerprint: recipeDraftFingerprint({
          ...savedDraft,
          title: "Different work",
        }),
        newIdempotencyKey: NEXT_SAVE_KEY,
        revision: 3,
      }),
    ).toEqual({
      fingerprint: recipeDraftFingerprint({
        ...savedDraft,
        title: "Different work",
      }),
      idempotencyKey: NEXT_SAVE_KEY,
      revision: 3,
    });
    expect(
      prepareDraftSaveAttempt(failed, {
        fingerprint: firstFingerprint,
        newIdempotencyKey: NEXT_SAVE_KEY,
        revision: 4,
      }),
    ).toEqual({
      fingerprint: firstFingerprint,
      idempotencyKey: NEXT_SAVE_KEY,
      revision: 4,
    });
  });

  it("keeps a failed attempt when edits change and return to its exact payload", () => {
    const originalTitle = "Retry this exact soup";
    const dirty = change(load(), originalTitle);
    const fingerprint =
      dirty.work.status === "unavailable"
        ? ""
        : recipeDraftFingerprint(dirty.work.draft);
    const attempt = prepareDraftSaveAttempt(dirty, {
      fingerprint,
      newIdempotencyKey: SAVE_KEY,
      revision: detail.revision,
    });
    const failed = recipeDraftEditorReducer(
      recipeDraftEditorReducer(dirty, { attempt, type: "save-started" }),
      {
        attemptId: SAVE_KEY,
        kind: "ambiguous-result",
        type: "save-failed",
      },
    );

    const changed = change(failed, "Temporary edit");
    expect(changed.save).toEqual({ attempt, status: "idle" });
    const restored = change(changed, originalTitle);
    expect(
      prepareDraftSaveAttempt(restored, {
        fingerprint,
        newIdempotencyKey: NEXT_SAVE_KEY,
        revision: detail.revision,
      }),
    ).toBe(attempt);
  });

  it("keeps discard confirmation explicit and scopes retries to one revision", () => {
    const dirty = change(load(), "Keep or discard");
    const requested = recipeDraftEditorReducer(dirty, {
      type: "discard-requested",
    });
    expect(requested.discard.confirmation).toBe("visible");

    const canceled = recipeDraftEditorReducer(requested, {
      type: "discard-canceled",
    });
    expect(canceled.discard.confirmation).toBe("hidden");
    expect(canceled.work).toBe(dirty.work);

    const attempt = prepareDraftDiscardAttempt(canceled, {
      newIdempotencyKey: DISCARD_KEY,
      revision: 3,
    });
    const discarding = recipeDraftEditorReducer(
      recipeDraftEditorReducer(canceled, { type: "discard-requested" }),
      { attempt, type: "discard-started" },
    );
    expect(discarding.discard).toEqual({
      confirmation: "visible",
      operation: { attempt, status: "discarding" },
    });

    const staleFailure = recipeDraftEditorReducer(discarding, {
      attemptId: NEXT_DISCARD_KEY,
      kind: "revision-conflict",
      type: "discard-failed",
    });
    expect(staleFailure).toBe(discarding);

    const failed = recipeDraftEditorReducer(discarding, {
      attemptId: DISCARD_KEY,
      kind: "revision-conflict",
      type: "discard-failed",
    });
    expect(failed.discard.operation).toEqual({
      attempt,
      status: "revision-conflict",
    });
    expect(
      prepareDraftDiscardAttempt(failed, {
        newIdempotencyKey: NEXT_DISCARD_KEY,
        revision: 3,
      }),
    ).toBe(attempt);
    expect(
      prepareDraftDiscardAttempt(failed, {
        newIdempotencyKey: NEXT_DISCARD_KEY,
        revision: 4,
      }),
    ).toEqual({ idempotencyKey: NEXT_DISCARD_KEY, revision: 4 });

    const saveAttempt = prepareDraftSaveAttempt(failed, {
      fingerprint: recipeDraftFingerprint(savedDraft),
      newIdempotencyKey: SAVE_KEY,
      revision: 3,
    });
    const saving = recipeDraftEditorReducer(failed, {
      attempt: saveAttempt,
      type: "save-started",
    });
    expect(saving.discard.operation).toEqual({ attempt, status: "idle" });
    const discardingAgain = recipeDraftEditorReducer(saving, {
      attempt,
      type: "discard-started",
    });
    expect(discardingAgain.save).toEqual({
      attempt: saveAttempt,
      status: "idle",
    });
  });

  it("distinguishes replacing local work from keeping newer local work", () => {
    const local = change(load(), "Unsaved local soup");
    const skipped = recipeDraftEditorReducer(local, {
      type: "reload-skipped-newer-work",
    });
    expect(skipped.notice).toBe("none");
    expect(skipped.work).toBe(local.work);

    const remoteDraft = { ...savedDraft, title: "Latest remote soup" };
    const replacement = recipeDraftEditorReducer(skipped, {
      detail: {
        ...detail,
        revision: 5,
        title: remoteDraft.title,
        updated_at: "2026-08-25T12:05:00Z",
      },
      draft: remoteDraft,
      mode: "replacement",
      type: "draft-loaded",
    });
    expect(replacement.notice).toBe("loaded-latest");
    expect(replacement.work).toMatchObject({
      detail: { revision: 5 },
      draft: remoteDraft,
      status: "clean",
    });
    expect(replacement.save.status).toBe("idle");
    expect(replacement.discard).toEqual({
      confirmation: "hidden",
      operation: { attempt: null, status: "idle" },
    });
  });
});
