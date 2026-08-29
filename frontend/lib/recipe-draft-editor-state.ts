import type { RecipeDraftDetail } from "./recipe-draft-api";
import {
  recipeDraftFingerprint,
  type RecipeDraftEditorState,
} from "./recipe-draft";

export interface DraftSaveAttempt {
  fingerprint: string;
  idempotencyKey: string;
  revision: number;
}

export interface DraftDiscardAttempt {
  idempotencyKey: string;
  revision: number;
}

export type DraftFailureKind =
  | "authentication-interruption"
  | "ambiguous-result"
  | "failed-retryable"
  | "revision-conflict";

export type DraftWorkSlice =
  | { status: "unavailable" }
  | {
      baselineFingerprint: string;
      detail: RecipeDraftDetail;
      draft: RecipeDraftEditorState;
      status: "clean" | "dirty";
    };

export type DraftSaveSlice =
  | { attempt: DraftSaveAttempt | null; status: "idle" }
  | { attempt: DraftSaveAttempt; status: "saving" }
  | { newerLocalWork: boolean; status: "saved" }
  | { attempt: DraftSaveAttempt; status: DraftFailureKind };

export type DraftDiscardOperation =
  | { attempt: DraftDiscardAttempt | null; status: "idle" }
  | { attempt: DraftDiscardAttempt; status: "discarding" }
  | { attempt: DraftDiscardAttempt; status: DraftFailureKind };

export interface DraftDiscardSlice {
  confirmation: "hidden" | "visible";
  operation: DraftDiscardOperation;
}

export type DraftEditorNotice = "loaded-latest" | "none";

export interface RecipeDraftEditorDomainState {
  discard: DraftDiscardSlice;
  notice: DraftEditorNotice;
  save: DraftSaveSlice;
  work: DraftWorkSlice;
}

export type RecipeDraftEditorEvent =
  | {
      detail: RecipeDraftDetail;
      draft: RecipeDraftEditorState;
      mode: "initial" | "replacement";
      type: "draft-loaded";
    }
  | { draft: RecipeDraftEditorState; type: "draft-changed" }
  | { attempt: DraftSaveAttempt; type: "save-started" }
  | {
      attemptId: string;
      detail: RecipeDraftDetail;
      draft: RecipeDraftEditorState;
      type: "save-succeeded";
    }
  | {
      attemptId: string;
      kind: DraftFailureKind;
      type: "save-failed";
    }
  | { type: "reload-skipped-newer-work" }
  | { type: "discard-requested" }
  | { type: "discard-canceled" }
  | { attempt: DraftDiscardAttempt; type: "discard-started" }
  | {
      attemptId: string;
      kind: DraftFailureKind;
      type: "discard-failed";
    };

export const initialRecipeDraftEditorDomainState: RecipeDraftEditorDomainState =
  {
    discard: {
      confirmation: "hidden",
      operation: { attempt: null, status: "idle" },
    },
    notice: "none",
    save: { attempt: null, status: "idle" },
    work: { status: "unavailable" },
  };

function saveAttempt(state: DraftSaveSlice): DraftSaveAttempt | null {
  return "attempt" in state ? state.attempt : null;
}

function discardAttempt(
  state: DraftDiscardOperation,
): DraftDiscardAttempt | null {
  return state.attempt;
}

export function prepareDraftSaveAttempt(
  state: RecipeDraftEditorDomainState,
  input: {
    fingerprint: string;
    newIdempotencyKey: string;
    revision: number;
  },
): DraftSaveAttempt {
  const previous = saveAttempt(state.save);
  if (
    previous?.fingerprint === input.fingerprint &&
    previous.revision === input.revision
  ) {
    return previous;
  }
  return {
    fingerprint: input.fingerprint,
    idempotencyKey: input.newIdempotencyKey,
    revision: input.revision,
  };
}

export function prepareDraftDiscardAttempt(
  state: RecipeDraftEditorDomainState,
  input: { newIdempotencyKey: string; revision: number },
): DraftDiscardAttempt {
  const previous = discardAttempt(state.discard.operation);
  if (previous?.revision === input.revision) {
    return previous;
  }
  return {
    idempotencyKey: input.newIdempotencyKey,
    revision: input.revision,
  };
}

export function recipeDraftEditorIsDirty(
  state: RecipeDraftEditorDomainState,
): boolean {
  return state.work.status === "dirty";
}

export function recipeDraftEditorReducer(
  state: RecipeDraftEditorDomainState,
  event: RecipeDraftEditorEvent,
): RecipeDraftEditorDomainState {
  switch (event.type) {
    case "draft-loaded":
      return {
        discard: {
          confirmation: "hidden",
          operation: { attempt: null, status: "idle" },
        },
        notice: event.mode === "replacement" ? "loaded-latest" : "none",
        save: { attempt: saveAttempt(state.save), status: "idle" },
        work: {
          baselineFingerprint: recipeDraftFingerprint(event.draft),
          detail: event.detail,
          draft: event.draft,
          status: "clean",
        },
      };

    case "draft-changed": {
      if (state.work.status === "unavailable") return state;
      const dirty =
        recipeDraftFingerprint(event.draft) !== state.work.baselineFingerprint;
      const operation = state.discard.operation;
      return {
        ...state,
        discard: {
          ...state.discard,
          operation:
            operation.status === "idle" || operation.status === "discarding"
              ? operation
              : { attempt: operation.attempt, status: "idle" },
        },
        notice: "none",
        save:
          state.save.status === "saving"
            ? state.save
            : { attempt: saveAttempt(state.save), status: "idle" },
        work: {
          ...state.work,
          draft: event.draft,
          status: dirty ? "dirty" : "clean",
        },
      };
    }

    case "save-started":
      if (state.work.status === "unavailable") return state;
      return {
        ...state,
        discard: {
          ...state.discard,
          operation: {
            attempt: discardAttempt(state.discard.operation),
            status: "idle",
          },
        },
        notice: "none",
        save: { attempt: event.attempt, status: "saving" },
      };

    case "save-succeeded": {
      if (
        state.work.status === "unavailable" ||
        state.save.status !== "saving" ||
        state.save.attempt.idempotencyKey !== event.attemptId
      ) {
        return state;
      }
      const hasNewerLocalWork =
        recipeDraftFingerprint(state.work.draft) !==
        state.save.attempt.fingerprint;
      const savedFingerprint = recipeDraftFingerprint(event.draft);
      return {
        ...state,
        notice: "none",
        save: { newerLocalWork: hasNewerLocalWork, status: "saved" },
        work: {
          baselineFingerprint: savedFingerprint,
          detail: event.detail,
          draft: hasNewerLocalWork ? state.work.draft : event.draft,
          status: hasNewerLocalWork ? "dirty" : "clean",
        },
      };
    }

    case "save-failed":
      if (
        state.save.status !== "saving" ||
        state.save.attempt.idempotencyKey !== event.attemptId
      ) {
        return state;
      }
      return {
        ...state,
        notice: "none",
        save: { attempt: state.save.attempt, status: event.kind },
      };

    case "reload-skipped-newer-work":
      return { ...state, notice: "none" };

    case "discard-requested":
      return {
        ...state,
        discard: { ...state.discard, confirmation: "visible" },
      };

    case "discard-canceled":
      return {
        ...state,
        discard: { ...state.discard, confirmation: "hidden" },
      };

    case "discard-started":
      return {
        ...state,
        discard: {
          confirmation: "visible",
          operation: { attempt: event.attempt, status: "discarding" },
        },
        save: { attempt: saveAttempt(state.save), status: "idle" },
      };

    case "discard-failed": {
      const operation = state.discard.operation;
      if (
        operation.status !== "discarding" ||
        operation.attempt.idempotencyKey !== event.attemptId
      ) {
        return state;
      }
      return {
        ...state,
        discard: {
          confirmation: "visible",
          operation: { attempt: operation.attempt, status: event.kind },
        },
      };
    }
  }
}
