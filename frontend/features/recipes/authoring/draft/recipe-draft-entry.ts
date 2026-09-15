"use client";

import {
  clearRecipeDraftCreationAttempt,
  getOrCreateRecipeDraftCreationAttempt,
  RecipeDraftCreationAttemptError,
} from "./recipe-draft-creation-attempt";
import {
  createRecipeDraft,
  fetchRecipeDraft,
  findActiveRecipeDraftForSource,
  RecipeDraftApiError,
  type RecipeDraftDetail,
} from "./recipe-draft-api";
import type { RecipeDraftKind } from "./recipe-draft-summary";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertDraftId(draftId: string): string {
  if (!UUID_PATTERN.test(draftId)) {
    throw new RecipeDraftApiError(
      "Recipe Lab could not confirm the private draft. Try again to recover the same draft.",
      502,
      "invalid_recipe_draft_response",
      [],
      "unknown",
    );
  }
  return draftId;
}

function assertDraftIntent(
  draftKind: RecipeDraftKind,
  sourceVersionId: string | null,
): void {
  if ((draftKind === "original") !== (sourceVersionId === null)) {
    throw new RecipeDraftApiError(
      "Recipe Lab could not identify the private draft you want to open.",
      0,
      "invalid_identifier",
    );
  }
}

export function recipeDraftEntryErrorMessage(reason: unknown): string {
  if (
    reason instanceof RecipeDraftApiError ||
    reason instanceof RecipeDraftCreationAttemptError
  ) {
    return reason.message;
  }
  return "Recipe Lab could not start this private draft. Try again to recover the same draft.";
}

async function createRecipeDraftWithRecovery(
  actorId: string,
  draftKind: RecipeDraftKind,
  sourceVersionId: string | null,
): Promise<RecipeDraftDetail> {
  let terminalConflictRecovered = false;
  while (true) {
    const attempt = getOrCreateRecipeDraftCreationAttempt(
      actorId,
      draftKind,
      sourceVersionId,
    );
    try {
      const draft = await createRecipeDraft(
        draftKind,
        sourceVersionId,
        attempt.idempotency_key,
      );
      assertDraftId(draft.id);
      clearRecipeDraftCreationAttempt(attempt, draftKind, sourceVersionId);
      return draft;
    } catch (reason) {
      const terminalConflict =
        reason instanceof RecipeDraftApiError &&
        reason.code === "idempotency_key_conflict";
      if (!terminalConflict) throw reason;

      clearRecipeDraftCreationAttempt(attempt, draftKind, sourceVersionId);
      if (terminalConflictRecovered) throw reason;
      terminalConflictRecovered = true;
    }
  }
}

export async function startOrResumeRecipeDraftDetail(
  actorId: string,
  draftKind: RecipeDraftKind,
  sourceVersionId: string | null,
): Promise<RecipeDraftDetail> {
  assertDraftIntent(draftKind, sourceVersionId);
  if (sourceVersionId !== null && draftKind !== "original") {
    const activeDraft = await findActiveRecipeDraftForSource(
      sourceVersionId,
      draftKind,
    );
    if (activeDraft !== null) {
      const detail = await fetchRecipeDraft(assertDraftId(activeDraft.id));
      if (
        detail.draft_kind !== draftKind ||
        detail.source_version_id?.toLowerCase() !== sourceVersionId.toLowerCase()
      ) {
        throw new RecipeDraftApiError(
          "Recipe Lab received an invalid private draft response.",
          502,
          "invalid_recipe_draft_response",
        );
      }
      return detail;
    }
  }

  return createRecipeDraftWithRecovery(actorId, draftKind, sourceVersionId);
}

export async function startOrResumeRecipeDraft(
  actorId: string,
  draftKind: RecipeDraftKind,
  sourceVersionId: string | null,
): Promise<string> {
  assertDraftIntent(draftKind, sourceVersionId);
  if (sourceVersionId !== null && draftKind !== "original") {
    const activeDraft = await findActiveRecipeDraftForSource(
      sourceVersionId,
      draftKind,
    );
    if (activeDraft !== null) return assertDraftId(activeDraft.id);
  }

  return assertDraftId(
    (await createRecipeDraftWithRecovery(actorId, draftKind, sourceVersionId))
      .id,
  );
}
